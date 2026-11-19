#!/usr/bin/env bash
# One-time, explicitly approved BookMyBus-only shared-edge installation.
set -Eeuo pipefail
umask 077
[[ ${1:-} == APPROVE_BOOKMYBUS_EDGE ]] || { echo 'Explicit edge approval required' >&2; exit 2; }
root=/opt/bookmybus-crs
proxy=gymproplus-nginx-1
config=/var/www/gymproplus/nginx/conf.d
helper=redis:8.2-alpine@sha256:da23c2478319ceb4903857d77a2fd7aa5137d9e9d4c8165dafbacedac6403e95
certbot=certbot/certbot@sha256:c5698da859429ccee0fcc299a8000368198222d1f9e789ab6e388b491e8ce06d
source_dir="$root/incoming/bookmybus-edge"
[[ $(cat "$root/.project-owner") == bookmybus-crs ]]
exec 8>"$root/edge-install.lock"; flock -n 8
mkdir -p "$root/shared/letsencrypt" "$root/logs/certbot" "$root/shared/edge-state"
docker exec "$proxy" sh -c 'sha256sum /etc/nginx/conf.d/*.conf' > "$root/shared/edge-state/before.sha256"
docker exec "$proxy" nginx -t
# Exclusive creation: never overwrite a pre-existing domain configuration.
docker run --rm --network none --user 0:0 -v "$config:/target" -v "$source_dir:/source:ro" "$helper" sh -ec '
  test ! -e /target/bookmybus.pro.conf
  cp /source/bookmybus-http.conf /target/bookmybus.pro.conf
  chmod 644 /target/bookmybus.pro.conf
'
docker exec "$proxy" nginx -t
docker exec "$proxy" nginx -s reload
docker run --rm --cpus 0.5 --memory 256m \
  -v "$root/shared/letsencrypt:/etc/letsencrypt" \
  -v "$root/logs/certbot:/var/log/letsencrypt" \
  -v gymproplus_certbot_www:/var/www/certbot \
  "$certbot" certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --webroot -w /var/www/certbot --cert-name bookmybus.pro \
  -d bookmybus.pro -d admin.bookmybus.pro -d partner.bookmybus.pro -d api.bookmybus.pro
docker run --rm --network none --user 0:0 \
  -v "$root/shared/letsencrypt:/source:ro" -v /etc/letsencrypt:/target \
  "$helper" sh -ec '
  test ! -e /target/live/bookmybus.pro
  mkdir -m 700 /target/live/bookmybus.pro
  cp -L /source/live/bookmybus.pro/fullchain.pem /target/live/bookmybus.pro/fullchain.pem
  cp -L /source/live/bookmybus.pro/privkey.pem /target/live/bookmybus.pro/privkey.pem
  chmod 600 /target/live/bookmybus.pro/privkey.pem
  chmod 644 /target/live/bookmybus.pro/fullchain.pem
'
if ! docker network inspect bookmybus-crs_edge >/dev/null 2>&1; then
  docker network create --label com.docker.compose.project=bookmybus-crs --label com.docker.compose.network=edge bookmybus-crs_edge >/dev/null
fi
[[ $(docker network inspect --format '{{index .Labels "com.docker.compose.project"}}' bookmybus-crs_edge) == bookmybus-crs ]]
docker network connect bookmybus-crs_edge "$proxy"
docker run --rm --network none --user 0:0 -v "$config:/target" -v "$source_dir:/source:ro" "$helper" sh -ec '
  cmp /target/bookmybus.pro.conf /source/bookmybus-http.conf
  cp /source/bookmybus-https.conf /target/.bookmybus.pro.pending
  chmod 644 /target/.bookmybus.pro.pending
  mv /target/.bookmybus.pro.pending /target/bookmybus.pro.conf
'
if docker exec "$proxy" nginx -t; then
  docker exec "$proxy" nginx -s reload
else
  docker run --rm --network none --user 0:0 -v "$config:/target" -v "$source_dir:/source:ro" "$helper" sh -ec 'cp /source/bookmybus-http.conf /target/bookmybus.pro.conf; chmod 644 /target/bookmybus.pro.conf'
  echo 'HTTPS config rejected; previous loaded proxy remains active; BookMyBus HTTP config restored.' >&2
  exit 1
fi
docker exec "$proxy" sh -c 'sha256sum /etc/nginx/conf.d/*.conf' > "$root/shared/edge-state/after.sha256"
grep -v '/bookmybus.pro.conf$' "$root/shared/edge-state/after.sha256" | cmp - "$root/shared/edge-state/before.sha256"
printf 'BookMyBus edge installed; all pre-existing configuration hashes unchanged.\n' | tee "$root/shared/edge-state/installed"
