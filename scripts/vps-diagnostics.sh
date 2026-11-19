#!/usr/bin/env bash
# Read-only diagnostics. Do NOT print docker inspect .Config.Env or .env files.
set -Eeuo pipefail
cat /etc/os-release
uname -m
free -h
df -h /opt /var/lib/docker
docker version --format '{{.Server.Version}}'
docker compose version
ss -ltn '( sport = :80 or sport = :443 or sport = :5020 )'
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'
docker network ls
docker inspect --format '{{json .NetworkSettings.Networks}}' gymproplus-nginx-1
docker inspect --format '{{range .Mounts}}{{println .Type .Source "->" .Destination}}{{end}}' gymproplus-nginx-1
# Review output privately: full config can include other apps' internal details.
docker exec gymproplus-nginx-1 nginx -T
for host in bookmybus.pro admin.bookmybus.pro partner.bookmybus.pro api.bookmybus.pro; do
  getent ahostsv4 "$host"
done
if [[ -e /opt/bookmybus-crs ]]; then echo 'Deployment directory already exists: inspect ownership before using it'; fi
