#!/usr/bin/env bash
set -Eeuo pipefail
api=${1:?API image required}; web=${2:?Web image required}; revision=${3:?Revision required}
[[ $revision =~ ^[a-f0-9]{40}$ ]] || exit 2
run="bookmybus-ci-${RANDOM}-$$"
cleanup() { docker rm -f "$run" >/dev/null 2>&1 || :; }
trap cleanup EXIT
for image in "$api" "$web"; do
  [[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$revision" ]]
done
# Import the real compiled app without starting servers or connecting to a DB.
docker run --rm --network none --read-only --cap-drop ALL "$api" node --input-type=module -e "await import('./dist/app.js'); console.log('Compiled API imports successfully')"
# Override only the API DNS in this disposable web container. No real upstream.
docker run -d --name "$run" --label bookmybus.ci=true --read-only --security-opt no-new-privileges:true --tmpfs /var/cache/nginx:size=32m --tmpfs /var/run:size=1m --tmpfs /tmp:size=16m --add-host api:127.0.0.1 "$web" >/dev/null
for attempt in {1..20}; do
  if docker exec "$run" wget -q -O /dev/null http://127.0.0.1:8080/gateway-health; then break; fi
  sleep 1
done
docker exec "$run" nginx -t
for host in bookmybus.pro admin.bookmybus.pro partner.bookmybus.pro; do
  actual=$(docker exec "$run" wget -q -O - --header "Host: $host" http://127.0.0.1:8080/deployment-revision)
  [[ $actual == "$revision" ]]
  case $host in
    bookmybus.pro) panel=operator ;;
    admin.bookmybus.pro) panel=admin ;;
    partner.bookmybus.pro) panel=partner ;;
  esac
  expected=$(docker exec "$run" sha256sum "/usr/share/nginx/$panel/index.html" | cut -d ' ' -f 1)
  actual=$(docker exec "$run" wget -q -O - --header "Host: $host" http://127.0.0.1:8080/ | sha256sum | cut -d ' ' -f 1)
  [[ $actual == "$expected" ]]
done
echo 'All three image routes and compiled API validated.'
