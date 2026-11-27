#!/usr/bin/env bash
set -Eeuo pipefail
if [[ ${1:-} != --inside ]]; then
  for script in scripts/{deploy,rollback,release-common}.sh scripts/ci/{image-smoke,ssh-deploy,test-release-scripts}.sh; do bash -n "$script"; done
  # Dedicated disposable, network-disabled container. No Docker socket is mounted.
  docker run --rm --network none -v "$PWD:/src:ro" node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8 bash /src/scripts/ci/test-release-scripts.sh --inside
  exit
fi
root=/opt/bookmybus-crs
mkdir -p "$root"/{shared,releases,logs,incoming} /tmp/mockbin
mkdir -p "$root/shared/redis-tls"
touch "$root/shared/redis-tls/ca.crt" "$root/shared/redis-tls/redis.conf"
printf 'bookmybus-crs\n' > "$root/.project-owner"
printf 'JWT_SECRET=synthetic-test\n' > "$root/shared/api.env"
chmod 600 "$root/shared/api.env"
printf 'CAR_CRS_JWT_SECRET=synthetic-test\nCAR_PROVIDER_JWT_SECRET=synthetic-test\n' > "$root/shared/car-sandbox.env"
chmod 600 "$root/shared/car-sandbox.env"
printf 'ghcr.io/owner/repo\n' > "$root/shared/registry-prefix"
cat > /tmp/mockbin/docker <<'MOCK'
#!/usr/bin/env bash
set -eu
root=/opt/bookmybus-crs
if [[ $1 == compose && $2 == version ]]; then echo 2.32.0; exit; fi
if [[ $1 == network || $1 == volume ]]; then
  if [[ ${FOREIGN_NAMESPACE:-} == yes ]]; then echo other-project; exit; fi
  exit 1
fi
[[ $1 == ps ]] && exit 0
if [[ $1 == image ]]; then printf '%s\n' "$REVISION"; exit; fi
if [[ $1 == compose ]]; then
  while [[ $1 != -f ]]; do shift; done
  shift 2
  case $1 in
    config|pull|run) exit 0 ;;
    up)
      if [[ -f $root/fail-once ]]; then rm "$root/fail-once"; exit 1; fi
      printf '%s\n' "$REVISION" > "$root/active-revision"; exit 0 ;;
  esac
fi
echo "Unexpected Docker invocation" >&2; exit 1
MOCK
cat > /tmp/mockbin/curl <<'MOCK'
#!/usr/bin/env bash
set -eu
case "$*" in
  */health/ready*) printf '{"data":{"status":"ready"}}' ;;
  */deployment-revision*) cat /opt/bookmybus-crs/active-revision ;;
  *) exit 0 ;;
esac
MOCK
cat > /tmp/mockbin/df <<'MOCK'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted\ntest 20000000 0 20000000 0 /\n'
MOCK
cat > /tmp/mockbin/awk <<'MOCK'
#!/usr/bin/env bash
if [[ ${2:-} == /proc/meminfo ]]; then echo 20000000; else /usr/bin/awk "$@"; fi
MOCK
printf '#!/usr/bin/env bash\nexit 0\n' > /tmp/mockbin/ss
chmod 700 /tmp/mockbin/*
export PATH="/tmp/mockbin:$PATH"
make_release() {
  local revision=$1 id="$1-1-1"
  mkdir -p "$root/releases/$id/scripts"
  mkdir -p "$root/releases/$id/deploy"
  cp /src/scripts/{deploy,rollback,release-common}.sh "$root/releases/$id/scripts/"
  cp /src/docker-compose.prod.yml /src/docker-compose.public-test.yml "$root/releases/$id/"
  cp /src/deploy/public-api-test-compose.env.example "$root/releases/$id/deploy/"
  printf 'REVISION=%s\nAPI_IMAGE=ghcr.io/owner/repo-api@sha256:%064d\nWEB_IMAGE=ghcr.io/owner/repo-web@sha256:%064d\nCAR_SANDBOX_IMAGE=ghcr.io/owner/repo-car-sandbox@sha256:%064d\n' "$revision" 1 2 3 > "$root/releases/$id/images.env"
}
a=$(printf 'a%.0s' {1..40}); b=$(printf 'b%.0s' {1..40})
make_release "$a"; make_release "$b"
script="$root/releases/$a-1-1/scripts"
if bash "$script/deploy.sh" invalid >/dev/null 2>&1; then echo 'Invalid release accepted'; exit 1; fi
printf '%s\n' "$a" > "$root/shared/approved-revision"
if FOREIGN_NAMESPACE=yes bash "$script/deploy.sh" "$a-1-1" >/dev/null 2>&1; then echo 'Foreign namespace accepted'; exit 1; fi
bash "$script/deploy.sh" "$a-1-1"
[[ $(realpath "$root/current") == "$root/releases/$a-1-1" ]]
printf '%s\n' "$b" > "$root/shared/approved-revision"
printf '%s\n' "$b" > "$root/shared/rollback-safe-revision"
touch "$root/fail-once"
if bash "$script/deploy.sh" "$b-1-1"; then echo 'Failed rollout reported success'; exit 1; fi
[[ $(cat "$root/active-revision") == "$a" && $(realpath "$root/current") == "$root/releases/$a-1-1" ]]
bash "$script/deploy.sh" "$b-1-1"
if bash "$script/rollback.sh" NO >/dev/null 2>&1; then echo 'Rollback confirmation bypassed'; exit 1; fi
bash "$script/rollback.sh" ROLLBACK
[[ $(cat "$root/active-revision") == "$a" && $(realpath "$root/current") == "$root/releases/$a-1-1" ]]
echo 'Release tests passed: ownership, confirmation, successful rollout, failed rollout, automatic recovery, explicit rollback.'
bash /src/scripts/ci/test-edge-network.sh
