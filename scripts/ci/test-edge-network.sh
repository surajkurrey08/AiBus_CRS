#!/usr/bin/env bash
# Called inside the existing network-disabled release-test container only.
set -Eeuo pipefail
[[ -f /src/scripts/ensure-bookmybus-edge.sh ]]
case_dir=$(mktemp -d)
trap 'rm -f -- "$case_dir/docker" "$case_dir/connected" "$case_dir/calls"; rmdir -- "$case_dir"' EXIT
export EDGE_CASE_DIR=$case_dir
cat > "$case_dir/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
case "$*" in
  'network inspect --format {{index .Labels "com.docker.compose.project"}} bookmybus-crs_edge') echo "${EDGE_NETWORK_OWNER:-bookmybus-crs}" ;;
  'inspect --format {{index .Config.Labels "com.docker.compose.project"}} gymproplus-nginx-1') echo "${EDGE_PROXY_OWNER:-gymproplus}" ;;
  'inspect --format {{index .Config.Labels "com.docker.compose.service"}} gymproplus-nginx-1') echo nginx ;;
  'inspect --format {{.State.Running}} gymproplus-nginx-1') echo "${EDGE_PROXY_RUNNING:-true}" ;;
  'network inspect --format {{range .Containers}}{{println .Name}}{{end}} bookmybus-crs_edge') if [[ -f $EDGE_CASE_DIR/connected ]]; then echo gymproplus-nginx-1; fi ;;
  'network connect bookmybus-crs_edge gymproplus-nginx-1') echo connected >> "$EDGE_CASE_DIR/calls"; touch "$EDGE_CASE_DIR/connected" ;;
  *) echo 'Unexpected Docker operation in edge test' >&2; exit 8 ;;
esac
MOCK
chmod 700 "$case_dir/docker"
export PATH="$case_dir:$PATH"
script=/src/scripts/ensure-bookmybus-edge.sh
if bash "$script" --check >/dev/null 2>&1; then echo 'Missing edge was reported healthy'; exit 1; fi
[[ ! -f $case_dir/calls ]]
if EDGE_NETWORK_OWNER=other bash "$script" --repair >/dev/null 2>&1; then echo 'Foreign network was accepted'; exit 1; fi
if EDGE_PROXY_OWNER=other bash "$script" --repair >/dev/null 2>&1; then echo 'Foreign proxy was accepted'; exit 1; fi
if EDGE_PROXY_RUNNING=false bash "$script" --repair >/dev/null 2>&1; then echo 'Stopped proxy was accepted'; exit 1; fi
[[ ! -f $case_dir/calls ]]
bash "$script" --repair
bash "$script" --check
bash "$script" --repair
[[ $(wc -l < "$case_dir/calls") == 1 ]]
echo 'Edge tests passed: missing network, ownership checks, stopped proxy, scoped repair, idempotency.'
