#!/usr/bin/env bash
# Restore only BookMyBus's approved edge connection after proxy recreation.
# No container restarts, proxy reloads or configuration edits are performed.
set -Eeuo pipefail
umask 077
root=/opt/bookmybus-crs
network=bookmybus-crs_edge
proxy=gymproplus-nginx-1
mode=${1:---check}
[[ $mode == --check || $mode == --repair ]] || { echo 'Use --check or --repair' >&2; exit 2; }
[[ -d $root && ! -L $root && $(cat "$root/.project-owner") == bookmybus-crs ]] || exit 2
if [[ $mode == --repair ]]; then
  exec 9>"$root/edge-network.lock"
  flock -n 9 || exit 0
fi
[[ $(docker network inspect --format '{{index .Labels "com.docker.compose.project"}}' "$network") == bookmybus-crs ]] || { echo 'Unexpected network owner; no change made' >&2; exit 2; }
[[ $(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$proxy") == gymproplus ]] || { echo 'Unexpected proxy owner; no change made' >&2; exit 2; }
[[ $(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$proxy") == nginx ]] || { echo 'Unexpected proxy service; no change made' >&2; exit 2; }
[[ $(docker inspect --format '{{.State.Running}}' "$proxy") == true ]] || { echo 'Shared proxy is not running; no restart attempted' >&2; exit 1; }
connected() {
  docker network inspect --format '{{range .Containers}}{{println .Name}}{{end}}' "$network" | grep -Fxq "$proxy"
}
connected && exit 0
[[ $mode == --repair ]] || { echo 'BookMyBus edge connection missing' >&2; exit 1; }
if ! docker network connect "$network" "$proxy"; then
  connected || exit 1
fi
connected || exit 1
printf '%s BookMyBus edge connection restored\n' "$(date -u +%FT%TZ)"
