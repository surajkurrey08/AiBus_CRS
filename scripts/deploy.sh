#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$(realpath "$0")")/release-common.sh"
require_root
exec 9>"$ROOT/deployment.lock"
flock -n 9 || fail 'Another deployment/rollback is running'
release=${1:?Release directory required}
[[ $release =~ ^[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || fail 'Invalid release identifier'
load_release "$ROOT/releases/$release"
check_namespace
[[ $(df -Pk "$ROOT" | awk 'NR==2 {print $4}') -ge 5242880 ]] || fail 'At least 5 GiB free disk required'
[[ $(awk '/MemAvailable/ {print $2}' /proc/meminfo) -ge 3145728 ]] || fail 'At least 3 GiB available RAM required'
if [[ ! -L $ROOT/current ]]; then
  ! ss -H -ltn 'sport = :5020' | grep -q . || fail 'Port 5020 is occupied'
fi
log="$ROOT/logs/deploy-$release.log"
echo "Preparing release $release; log: $log"
compose config --quiet >>"$log" 2>&1
compose pull >>"$log" 2>&1
for image in "$API_IMAGE" "$WEB_IMAGE"; do
  [[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "$REVISION" ]] || fail 'Image revision mismatch'
done
[[ $(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CAR_SANDBOX_IMAGE") == "$REVISION" ]] || fail 'Car sandbox image revision mismatch'
compose run --rm --no-deps api node --input-type=module -e "import {readConfig} from './dist/config/env.js';readConfig();console.log('Production configuration validated')" >>"$log" 2>&1
previous=''
if [[ -L $ROOT/current ]]; then
  previous=$(realpath -e "$ROOT/current")
  candidate=$RELEASE
  load_release "$previous"
  health || fail 'Current application is unhealthy; investigate before replacing it'
  load_release "$candidate"
fi
# No migrations are run. An operator must approve compatibility/backups per release.
[[ -f $ROOT/shared/approved-revision && $(cat "$ROOT/shared/approved-revision") == "$REVISION" ]] || fail 'Backup/schema/rollback review must approve this exact revision'
if compose up -d --wait --wait-timeout 180 >>"$log" 2>&1 && wait_health; then
  [[ -z $previous ]] || { ln -sfn "$previous" "$ROOT/previous.next"; mv -Tf "$ROOT/previous.next" "$ROOT/previous"; }
  ln -sfn "$RELEASE" "$ROOT/current.next"; mv -Tf "$ROOT/current.next" "$ROOT/current"
  echo "SUCCESS: $REVISION is ready; exact digests recorded in $RELEASE/images.env"
else
  echo "FAILED: Candidate is unhealthy; see private log $log" >&2
  if [[ -n $previous && -f $ROOT/shared/rollback-safe-revision && $(cat "$ROOT/shared/rollback-safe-revision") == "$REVISION" ]]; then
    load_release "$previous"
    if compose up -d --wait --wait-timeout 180 >>"$log" 2>&1 && wait_health; then
      echo 'ROLLBACK SUCCEEDED: previous healthy release restored' >&2
    else echo 'ROLLBACK FAILED: manual incident response required' >&2; fi
  else echo 'Automatic rollback not approved/available; no data was reverted. Manual recovery required.' >&2; fi
  exit 1
fi
