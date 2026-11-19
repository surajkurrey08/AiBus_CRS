#!/usr/bin/env bash
set -Eeuo pipefail
source "$(dirname "$(realpath "$0")")/release-common.sh"
require_root
[[ ${1:-} == ROLLBACK ]] || fail 'Explicit ROLLBACK confirmation required'
exec 9>"$ROOT/deployment.lock"
flock -n 9 || fail 'Another deployment/rollback is running'
candidate=$(realpath -e "$ROOT/current")
load_release "$candidate"
[[ -f $ROOT/shared/rollback-safe-revision && $(cat "$ROOT/shared/rollback-safe-revision") == "$REVISION" ]] || fail 'Current revision has no approved backward-compatible rollback'
load_release "$ROOT/previous"
log="$ROOT/logs/rollback-$(date -u +%Y%m%dT%H%M%SZ).log"
compose config --quiet >>"$log" 2>&1
compose pull >>"$log" 2>&1
compose up -d --wait --wait-timeout 180 >>"$log" 2>&1
wait_health || fail "Rollback unhealthy; inspect $log"
ln -sfn "$RELEASE" "$ROOT/current.next"; mv -Tf "$ROOT/current.next" "$ROOT/current"
ln -sfn "$candidate" "$ROOT/previous.next"; mv -Tf "$ROOT/previous.next" "$ROOT/previous"
echo "ROLLBACK SUCCEEDED: $REVISION; database and uploads were not reverted"
