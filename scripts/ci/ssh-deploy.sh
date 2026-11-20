#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ ${SSH_HOST:-} =~ ^[a-zA-Z0-9.-]+$ && ${SSH_USER:-} =~ ^[a-z_][a-z0-9_-]*$ && ${SSH_PORT:-} =~ ^[0-9]{1,5}$ ]] || { echo 'Invalid SSH configuration' >&2; exit 2; }
prefix="ghcr.io/${GITHUB_REPOSITORY,,}"
[[ $GITHUB_SHA =~ ^[a-f0-9]{40}$ && $GITHUB_RUN_ID =~ ^[0-9]+$ && $GITHUB_RUN_ATTEMPT =~ ^[0-9]+$ ]]
[[ $API_IMAGE == "$prefix-api@sha256:"* && ${API_IMAGE##*@sha256:} =~ ^[a-f0-9]{64}$ ]]
[[ $WEB_IMAGE == "$prefix-web@sha256:"* && ${WEB_IMAGE##*@sha256:} =~ ^[a-f0-9]{64}$ ]]
tmp=$(mktemp -d)
cleanup() { rm -f -- "$tmp/key" "$tmp/known_hosts" "$tmp/release.tar.gz"; rmdir -- "$tmp"; }
trap cleanup EXIT
printf '%s\n' "$SSH_PRIVATE_KEY" > "$tmp/key"
printf '%s\n' "$SSH_KNOWN_HOSTS" > "$tmp/known_hosts"
unset SSH_PRIVATE_KEY SSH_KNOWN_HOSTS
ssh-keygen -l -f "$tmp/known_hosts" >/dev/null
options=(-i "$tmp/key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$tmp/known_hosts" -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
release="$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
[[ ${GHCR_USER:-} =~ ^[a-zA-Z0-9_-]+$ && -n ${GHCR_TOKEN:-} ]]
tar -czf "$tmp/release.tar.gz" docker-compose.prod.yml docker-compose.public-test.yml deploy/public-api-test-compose.env.example scripts/deploy.sh scripts/rollback.sh scripts/release-common.sh
scp "${options[@]}" -P "$SSH_PORT" "$tmp/release.tar.gz" "$SSH_USER@$SSH_HOST:/opt/bookmybus-crs/incoming/$release.tar.gz"
# Short-lived repository-scoped read token, encrypted SSH stdin, private config.
# The token is never included in an argv, artifact, image, manifest or log.
printf '%s' "$GHCR_TOKEN" | ssh "${options[@]}" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "umask 077; mkdir -m 700 /opt/bookmybus-crs/incoming/auth-$release && docker --config /opt/bookmybus-crs/incoming/auth-$release login ghcr.io -u $GHCR_USER --password-stdin >/dev/null"
unset GHCR_TOKEN
ssh "${options[@]}" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" bash -s -- "$release" "$GITHUB_SHA" "$API_IMAGE" "$WEB_IMAGE" <<'REMOTE'
set -Eeuo pipefail
umask 077
root=/opt/bookmybus-crs
release=$1; revision=$2; api=$3; web=$4
[[ $release =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ && $revision =~ ^[a-f0-9]{40}$ ]]
export DOCKER_CONFIG="$root/incoming/auth-$release"
trap 'rm -f -- "$DOCKER_CONFIG/config.json"; rmdir -- "$DOCKER_CONFIG"' EXIT
[[ -d $root && ! -L $root && $(cat "$root/.project-owner") == bookmybus-crs ]]
mkdir "$root/releases/$release"
tar -xzf "$root/incoming/$release.tar.gz" -C "$root/releases/$release" --no-same-owner --no-same-permissions
printf 'REVISION=%s\nAPI_IMAGE=%s\nWEB_IMAGE=%s\n' "$revision" "$api" "$web" > "$root/releases/$release/images.env"
bash "$root/releases/$release/scripts/deploy.sh" "$release"
REMOTE
