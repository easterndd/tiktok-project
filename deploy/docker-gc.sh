#!/bin/sh
# Docker 发布残留回收：容器 / 镜像 / 构建缓存
#
# 背景：本机发布会为每个版本新建容器，旧容器和历史镜像不会自动清理。
# 曾经 3 天内累积 88 个容器、70 个镜像，并在 covers 容器里堆出 56G 日志。
#
# 规则（默认保守，running 容器永不动）：
#   1. 删除 exited 超过 CONTAINER_KEEP_HOURS（默认 72h）的容器
#   2. 删除无任何容器引用、且创建超过 IMAGE_KEEP_HOURS（默认 168h）的镜像
#   3. build cache 超过 BUILD_CACHE_MAX（默认 2gb）时回收
#
# 用法：
#   ./docker-gc.sh            # 执行清理
#   ./docker-gc.sh dry-run    # 只列出将被清理的对象，不做任何修改
#
# 可调环境变量（写在 systemd unit 的 Environment= 里）：
#   CONTAINER_KEEP_HOURS=72 IMAGE_KEEP_HOURS=168 BUILD_CACHE_MAX=2gb

set -eu

CONTAINER_KEEP_HOURS=${CONTAINER_KEEP_HOURS:-72}
IMAGE_KEEP_HOURS=${IMAGE_KEEP_HOURS:-168}
BUILD_CACHE_MAX=${BUILD_CACHE_MAX:-2gb}
MODE=${1:-apply}

log() { echo "[docker-gc] $*"; }

# 串行执行，避免与 disk-guard 或手动操作并发
exec 9>/run/quickreels-docker-gc.lock
flock -n 9 || { log "another instance is running, skip"; exit 0; }

before=$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
log "start mode=$MODE container_keep=${CONTAINER_KEEP_HOURS}h image_keep=${IMAGE_KEEP_HOURS}h disk=${before}%"

if [ "$MODE" = "dry-run" ]; then
  log "--- exited containers (those older than ${CONTAINER_KEEP_HOURS}h will be removed) ---"
  docker ps -a --filter status=exited --format '{{.Names}}\t{{.Image}}\t{{.Status}}' | head -30 || echo "(none)"
  log "--- images: no container references and created > ${IMAGE_KEEP_HOURS}h ---"
  docker images --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}' | head -10
  log "--- build cache ---"
  docker system df -v 2>/dev/null | grep -i "Build cache" || true
  log "dry-run end, nothing changed"
  exit 0
fi

# 1. 旧容器
removed_containers=$(docker container prune --filter "until=${CONTAINER_KEEP_HOURS}h" --force 2>&1 | tail -1)
log "containers: ${removed_containers:-nothing}"

# 2. 无引用镜像（docker 不会删除 running 容器正在使用的镜像）
removed_images=$(docker image prune -a --filter "until=${IMAGE_KEEP_HOURS}h" --force 2>&1 | tail -1)
log "images: ${removed_images:-nothing}"

# 3. build cache
if docker builder prune --force --keep-storage "$BUILD_CACHE_MAX" >/dev/null 2>&1; then
  log "build cache: pruned to <= ${BUILD_CACHE_MAX}"
else
  log "build cache: prune skipped"
fi

after=$(df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
log "done disk ${before}% -> ${after}%"

# 使用率持续偏高时写 journal，方便配合 quickreels-disk-guard 的告警
if [ "$after" -ge 85 ]; then
  logger -p daemon.crit -t quickreels-docker-gc "root filesystem at ${after}% after gc"
elif [ "$after" -ge 75 ]; then
  logger -p daemon.warning -t quickreels-docker-gc "root filesystem at ${after}% after gc"
fi
