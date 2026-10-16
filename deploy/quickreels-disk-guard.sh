#!/bin/sh
set -eu

exec 9>/run/quickreels-disk-guard.lock
flock -n 9 || exit 0

used=$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
if [ "$used" -ge 70 ]; then
  docker buildx prune --all --force --max-used-space 2gb
  docker image prune --all --force --filter until=168h
  used=$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
fi

if [ "$used" -ge 85 ]; then
  logger -p daemon.crit -t quickreels-disk-guard "Root filesystem remains at ${used}% after build-cache cleanup"
  exit 1
fi
if [ "$used" -ge 75 ]; then
  logger -p daemon.warning -t quickreels-disk-guard "Root filesystem is at ${used}%"
fi
