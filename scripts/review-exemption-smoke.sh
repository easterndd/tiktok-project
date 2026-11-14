#!/usr/bin/env bash
# 审核包自动豁免入场强弹 IP —— 端到端冒烟脚本
#
# 覆盖链路：
#   1. 管理员登录
#   2. 把测试版本置为审核中（IN_REVIEW），已登记则复用
#   3. 匿名用户以该 releaseId 启动（/auth/launch-context）
#   4. 共享库应出现 note=AUTO_REVIEW: <miniAppKey>:<releaseId> 的豁免行
#   5. 反向验证：未登记的 releaseId 不会写入豁免
#
# 用法：
#   API_BASE=https://api.example.com/api/v1 \
#   ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='***' \
#   MINI_APP_KEY=taletv RELEASE_ID=taletv-20261114-smoke \
#   bash scripts/review-exemption-smoke.sh
#
# 可选：
#   CLEANUP=1  结束后删除本次写入的豁免行，并把版本状态改回 RELEASED
#
# 注意：脚本会以本机出口 IP 触发写入；若 API 在代理后，请确认
# TRUSTED_PROXY_CIDRS / X-Forwarded-For 配置能让 request.ip 拿到真实 IP。
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3000/api/v1}"
ADMIN_EMAIL="${ADMIN_EMAIL:?请设置 ADMIN_EMAIL}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?请设置 ADMIN_PASSWORD}"
MINI_APP_KEY="${MINI_APP_KEY:-main}"
RELEASE_ID="${RELEASE_ID:-${MINI_APP_KEY}-review-smoke-$(date +%Y%m%d%H%M%S)}"
CLEANUP="${CLEANUP:-0}"
REVIEW_NOTE="AUTO_REVIEW: ${MINI_APP_KEY}:${RELEASE_ID}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
pass() { printf '\033[32m✓ %s\033[0m\n' "$*"; }

# http METHOD PATH [JSON body] [token] -> 响应体写入 $tmpdir/body，状态码存入 HTTP_CODE
http() {
  local method="$1" path="$2" body="${3:-}" token="${4:-}"
  local args=(-sS -o "$tmpdir/body" -w '%{http_code}' -X "$method" "$API_BASE$path")
  [ -n "$token" ] && args+=(-H "authorization: Bearer $token")
  [ -n "$body" ] && args+=(-H 'content-type: application/json' -d "$body")
  HTTP_CODE="$(curl "${args[@]}")" || fail "请求失败：$method $path"
}

# json_get key1 key2 ... （从 $tmpdir/body 读取）
json_get() {
  node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let value;
      try { value = JSON.parse(raw); } catch { process.stdout.write(""); return; }
      for (const key of process.argv.slice(1)) value = value == null ? value : value[key];
      process.stdout.write(value == null ? "" : String(value));
    });
  ' "$@" < "$tmpdir/body"
}

# 统计本轮版本的自动豁免行；命中时逐行打印 ip / updatedBy，未命中返回非 0
review_rows() {
  node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      const note = process.argv[1];
      let items = [];
      try { items = JSON.parse(raw).items ?? []; } catch { items = []; }
      const rows = items.filter((item) => item.note === note);
      for (const row of rows) console.log(`${row.ipAddress}\t${row.updatedBy}\t${row.createdAt}`);
      if (!rows.length) process.exitCode = 3;
    });
  ' "$REVIEW_NOTE" < "$tmpdir/body"
}

say "0/5 目标：$API_BASE  $MINI_APP_KEY / $RELEASE_ID"

say "1/5 管理员登录"
http POST /admin/auth/login "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}"
[ "$HTTP_CODE" = "200" ] || { cat "$tmpdir/body"; fail "登录失败（HTTP $HTTP_CODE）"; }
admin_token="$(json_get accessToken)"
[ -n "$admin_token" ] || fail "登录响应里没有 accessToken"
pass "已获取管理员 token"

say "2/5 登记版本并置为审核中"
http POST /admin/app-entry-ad-releases \
  "{\"releaseId\":\"$RELEASE_ID\",\"portalStatus\":\"IN_REVIEW\",\"portalVersion\":\"smoke\"}" "$admin_token"
case "$HTTP_CODE" in
  200) pass "已登记版本（IN_REVIEW）" ;;
  409) pass "版本已登记，改为 PATCH 更新状态" ;;
  *) cat "$tmpdir/body"; fail "登记版本失败（HTTP $HTTP_CODE）" ;;
esac
http PATCH "/admin/app-entry-ad-releases/$RELEASE_ID" '{"portalStatus":"IN_REVIEW","portalVersion":"smoke"}' "$admin_token"
[ "$HTTP_CODE" = "200" ] || { cat "$tmpdir/body"; fail "设置 IN_REVIEW 失败（HTTP $HTTP_CODE）"; }
pass "portalStatus = IN_REVIEW（同实例缓存已失效）"

say "3/5 以该版本启动一个匿名会话"
visitor_key="smoke-$RANDOM$(date +%s)-0123456789abcdef0123456789abcdef"
http POST /auth/anonymous/session \
  "{\"visitorKey\":\"$visitor_key\",\"clientSessionId\":\"smoke-session-$RANDOM\"}"
[ "$HTTP_CODE" = "200" ] || { cat "$tmpdir/body"; fail "匿名会话失败（HTTP $HTTP_CODE）"; }
viewer_token="$(json_get accessToken)"
http POST /auth/launch-context \
  "{\"entryId\":\"smoke-entry-$RANDOM\",\"releaseId\":\"$RELEASE_ID\"}" "$viewer_token"
[ "$HTTP_CODE" = "200" ] || { cat "$tmpdir/body"; fail "launch-context 失败（HTTP $HTTP_CODE）"; }
eligibility="$(json_get entryAdEligibility reason)"
printf '  entryAdEligibility = %s\n' "${eligibility:-<该小程序不走本地入场广告判定>}"
pass "启动链路已执行（IP 写入应在响应返回前完成）"

say "4/5 检查共享库豁免记录"
http GET /admin/shared/entry-ad-ip-exemptions "" "$admin_token"
[ "$HTTP_CODE" = "200" ] || { cat "$tmpdir/body"; fail "豁免列表读取失败（HTTP $HTTP_CODE）"; }
rows="$(review_rows < "$tmpdir/body" || true)"
if [ -z "$rows" ]; then
  fail "没有找到 note=${REVIEW_NOTE} 的记录。排查顺序：
   1) 该 releaseId 的 portalStatus 是否确为 IN_REVIEW（后台版本列表）
   2) API 是否连到同一个共享库（SHARED_PLATFORM_DATABASE_URL）
   3) request.ip 是否被代理改写成内网 IP（看后台 IP 汇总里的 ipAddress）
   4) 多实例部署时其它实例最多有 30s 状态缓存，可重试一次"
fi
printf '%s\n' "$rows" | while IFS=$'\t' read -r ip updated_by created_at; do
  printf '  %s  %s  %s\n' "$ip" "$updated_by" "$created_at"
done
pass "命中 $(printf '%s\n' "$rows" | wc -l | tr -d ' ') 条自动豁免（updatedBy 应为 system:review-release）"

say "5/5 反向验证：未登记版本不写入"
before="$(review_rows < "$tmpdir/body" | wc -l | tr -d ' ' || true)"
http POST /auth/launch-context \
  "{\"entryId\":\"smoke-entry-$RANDOM\",\"releaseId\":\"${MINI_APP_KEY}-not-registered-smoke\"}" "$viewer_token"
[ "$HTTP_CODE" = "200" ] || { cat "$tmpdir/body"; fail "反向用例请求失败（HTTP $HTTP_CODE）"; }
http GET /admin/shared/entry-ad-ip-exemptions "" "$admin_token"
after="$(review_rows < "$tmpdir/body" | wc -l | tr -d ' ' || true)"
[ "$before" = "$after" ] && pass "未登记版本未写入豁免（$before → $after）" || fail "未登记版本也写入了豁免（$before → $after）"

if [ "$CLEANUP" = "1" ]; then
  say "清理：删除本次自动豁免并置回 RELEASED"
  printf '%s\n' "$rows" | while IFS=$'\t' read -r ip _rest; do
    [ -n "$ip" ] && http DELETE "/admin/shared/entry-ad-ip-exemptions/$ip" "" "$admin_token"
  done
  http PATCH "/admin/app-entry-ad-releases/$RELEASE_ID" '{"portalStatus":"RELEASED","portalVersion":"smoke"}' "$admin_token"
  pass "已清理（如仍保留请到后台“广告配置”页确认）"
else
  say "提示：CLEANUP=1 可自动删除本次豁免；否则请到后台“广告配置”页按备注 $REVIEW_NOTE 手工清理"
fi

say "全部通过"
