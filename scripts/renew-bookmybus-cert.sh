#!/usr/bin/env bash
# Scheduled only for BookMyBus's isolated certificate configuration.
set -Eeuo pipefail
umask 077
root=/opt/bookmybus-crs
[[ $(cat "$root/.project-owner") == bookmybus-crs ]]
exec 8>"$root/edge-install.lock"; flock -n 8 || exit 0
helper=redis:8.2-alpine@sha256:da23c2478319ceb4903857d77a2fd7aa5137d9e9d4c8165dafbacedac6403e95
docker run --rm --cpus 0.5 --memory 256m \
  -v "$root/shared/letsencrypt:/etc/letsencrypt" \
  -v "$root/logs/certbot:/var/log/letsencrypt" \
  -v gymproplus_certbot_www:/var/www/certbot \
  certbot/certbot@sha256:c5698da859429ccee0fcc299a8000368198222d1f9e789ab6e388b491e8ce06d \
  renew --non-interactive --cert-name bookmybus.pro --quiet
if docker run --rm --network none --user 0:0 \
  -v "$root/shared/letsencrypt:/source:ro" -v /etc/letsencrypt/live/bookmybus.pro:/target:ro \
  "$helper" cmp /source/live/bookmybus.pro/fullchain.pem /target/fullchain.pem; then exit 0; fi
docker run --rm --network none --user 0:0 \
  -v "$root/shared/letsencrypt:/source:ro" -v /etc/letsencrypt/live/bookmybus.pro:/target \
  "$helper" sh -ec '
  cp -L /source/live/bookmybus.pro/fullchain.pem /target/fullchain.pending
  cp -L /source/live/bookmybus.pro/privkey.pem /target/privkey.pending
  chmod 644 /target/fullchain.pending
  chmod 600 /target/privkey.pending
  mv /target/fullchain.pending /target/fullchain.pem
  mv /target/privkey.pending /target/privkey.pem
'
docker exec gymproplus-nginx-1 nginx -t
docker exec gymproplus-nginx-1 nginx -s reload
