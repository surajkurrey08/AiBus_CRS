#!/usr/bin/env bash
# Sourced by deploy/rollback only; no global Docker lifecycle operations.
set -Eeuo pipefail
umask 077
ROOT=/opt/bookmybus-crs
PROJECT=bookmybus-crs
fail() { echo "ERROR: $*" >&2; exit 1; }
require_root() {
  [[ -d $ROOT && ! -L $ROOT && $(cat "$ROOT/.project-owner") == bookmybus-crs ]] || fail 'Dedicated deployment directory not provisioned'
  [[ $(stat -c %a "$ROOT/shared/api.env") == 600 ]] || fail 'api.env must have mode 0600'
  export APP_ENV_FILE="$ROOT/shared/api.env"
  export REDIS_TLS_DIR="$ROOT/shared/redis-tls"
  [[ -r $REDIS_TLS_DIR/ca.crt && -r $REDIS_TLS_DIR/redis.conf ]] || fail 'Dedicated TLS Redis configuration missing'
  grep -Eq '^[^#].*(REPLACE_|replace-|example\.com)' "$APP_ENV_FILE" && fail 'Production environment still contains example values'
  command -v docker >/dev/null; command -v curl >/dev/null; command -v flock >/dev/null
  docker compose version --short | grep -Eq '^v?2\.(3[0-9]|[4-9][0-9])\.|^v?[3-9]\.' || fail 'Docker Compose >= 2.30 required for raw env files'
  [[ $(uname -m) == x86_64 ]] || fail 'Current pipeline publishes linux/amd64 only'
}
load_release() {
  RELEASE=$(realpath -e -- "$1")
  [[ $RELEASE == "$ROOT/releases/"* && $RELEASE != *'/../'* && -f $RELEASE/images.env ]] || fail 'Release outside application directory'
  [[ $(dirname "$RELEASE") == "$ROOT/releases" ]] || fail 'Nested release rejected'
  REVISION=$(sed -n 's/^REVISION=//p' "$RELEASE/images.env")
  API_IMAGE=$(sed -n 's/^API_IMAGE=//p' "$RELEASE/images.env")
  WEB_IMAGE=$(sed -n 's/^WEB_IMAGE=//p' "$RELEASE/images.env")
  [[ $REVISION =~ ^[a-f0-9]{40}$ ]] || fail 'Invalid revision'
  local prefix
  prefix=$(cat "$ROOT/shared/registry-prefix")
  [[ $prefix =~ ^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+$ ]] || fail 'Invalid registry allowlist'
  [[ $API_IMAGE == "$prefix-api@sha256:"* && ${API_IMAGE##*@sha256:} =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid API image digest'
  [[ $WEB_IMAGE == "$prefix-web@sha256:"* && ${WEB_IMAGE##*@sha256:} =~ ^[a-f0-9]{64}$ ]] || fail 'Invalid web image digest'
  [[ $(wc -l < "$RELEASE/images.env") == 3 ]] || fail 'Unexpected image manifest fields'
  export API_IMAGE WEB_IMAGE REVISION
}
compose() { docker compose --project-directory "$RELEASE" --env-file "$RELEASE/images.env" -p "$PROJECT" -f "$RELEASE/docker-compose.prod.yml" "$@"; }
health() {
  curl -fsS --max-time 8 -H 'Host: api.bookmybus.pro' http://127.0.0.1:5020/health/ready | grep -q '"status":"ready"' || return 1
  local host actual
  for host in bookmybus.pro admin.bookmybus.pro partner.bookmybus.pro; do
    actual=$(curl -fsS --max-time 8 -H "Host: $host" http://127.0.0.1:5020/deployment-revision) || return 1
    [[ $actual == "$REVISION" ]] || return 1
    curl -fsS --max-time 8 -o /dev/null -H "Host: $host" http://127.0.0.1:5020/ || return 1
  done
}
wait_health() { for attempt in {1..30}; do health && return 0; sleep 2; done; return 1; }
check_namespace() {
  local kind target owner
  for resource in network:bookmybus-crs_edge network:bookmybus-crs_data volume:bookmybus-crs_uploads volume:bookmybus-crs_redis-data; do
    kind=${resource%%:*}; target=${resource#*:}
    if docker "$kind" inspect "$target" >/dev/null 2>&1; then
      owner=$(docker "$kind" inspect --format '{{index .Labels "com.docker.compose.project"}}' "$target")
      [[ $owner == "$PROJECT" ]] || fail "Existing $kind has different ownership"
    fi
  done
  if [[ ! -L $ROOT/current ]]; then
    # Dedicated Redis may be provisioned and health-tested before the first API
    # deployment. An existing api/web still requires a trusted release pointer.
    for service in api web; do
      if docker ps -aq --filter label=com.docker.compose.project="$PROJECT" --filter label=com.docker.compose.service="$service" | grep -q .; then fail 'Existing application has no trusted release pointer'; fi
    done
  fi
}
