export type DebugErrorContext = {
  path?: unknown;
  pageOrigin?: unknown;
  apiOrigin?: unknown;
  crossOrigin?: unknown;
  preflightRequired?: unknown;
  browserOnline?: unknown;
  timedOut?: unknown;
  aborted?: unknown;
};

export function debugErrorZh(code: unknown, message: unknown, statusCode?: unknown, context: DebugErrorContext = {}): string | null {
  const rawCode = String(code ?? '').trim();
  const rawMessage = String(message ?? '').trim();
  const combined = `${rawCode} ${rawMessage}`.toLowerCase();
  const status = Number(statusCode);

  if (/50008|env check failed|unavailable for iaa/.test(combined)) {
    return 'TikTok 客户端环境检查未通过，当前环境不可使用应用内广告。需核对真机客户端、应用广告权限及运行环境；仅凭此错误不能判定广告位 ID 有误。';
  }
  if (/ad_show_failed|entry_ad_show_failed/.test(combined)) {
    return '广告 SDK 展示失败，但当前记录没有具体原因码；请查看同一次广告的原始错误及相邻埋点。';
  }
  if (/entry_gate_slow/.test(combined)) {
    return '入口广告流程超过预期时间仍未完成；请结合广告加载、展示、关闭和接口请求的耗时排查。';
  }
  if (context.timedOut === true || /timeout|timed out/.test(combined)) return '请求超过客户端超时上限，已主动中止；请对照耗时、接口路径和服务端请求日志。';
  if (context.aborted === true || /aborterror/.test(combined)) return '请求被页面或调用方取消；没有证据表明 API 返回错误。';
  if (status === 401 || status === 403) return '接口鉴权或权限校验未通过；请核对登录会话及接口权限。';
  if (status === 404 && context.path === '/analytics/events') return '埋点上传接口返回 404：当前 API 没有提供这个路由，或代理转发路径不匹配；本批埋点未写入数据库。';
  if (status === 404) return '接口或资源返回 404；请核对请求路径、目标服务和部署版本。';
  if (status === 408) return '服务器返回请求超时（HTTP 408）；请结合请求 ID 查服务端处理日志。';
  if (status === 429) return '接口请求受到限流；请检查请求频率和服务端限流日志。';
  if (status === 502) return '网关返回 502；请检查 Caddy 到 API 上游的连接与 API 容器状态。';
  if (status === 503) return '服务返回 503；请检查 API 容量、健康状态和 Retry-After。';
  if (status === 504) return '网关等待上游超时（HTTP 504）；请检查 API 和数据库的响应耗时。';
  if (status >= 500 && status <= 599) return '服务器返回错误；请用请求 ID 和时间查对应服务日志。';
  if (status >= 400 && status <= 499) return '接口请求未通过校验；请查看原始错误和请求 ID。';
  if (/failed to fetch|load failed|network error|networkerror/.test(combined)) {
    if (context.browserOnline === false) return '设备报告处于离线状态，请先检查当前网络连接。';
    if (context.crossOrigin === true) {
      const origin = typeof context.pageOrigin === 'string' ? context.pageOrigin : '当前页面';
      const target = typeof context.apiOrigin === 'string' ? context.apiOrigin : 'API 域名';
      if (context.preflightRequired === true) return `跨域请求未收到 HTTP 响应：${origin} → ${target}。此请求需要 OPTIONS 预检；先检查预检状态及 Access-Control-Allow-Origin/Headers。浏览器未提供底层错误，不能仅凭此记录断定是 CORS。`;
      return `跨域请求未收到 HTTP 响应：${origin} → ${target}。先检查跨域响应头、域名连接和浏览器网络面板；当前记录不能判定具体原因。`;
    }
    if (context.crossOrigin === false) return '同源请求未收到 HTTP 响应；检查本地代理或服务连接，并对照网络面板。浏览器未提供具体失败原因。';
    return '浏览器未收到可读取的 HTTP 响应；当前记录缺少跨域和连接证据，无法判定具体原因。';
  }
  if (rawCode || rawMessage) return '当前没有可靠的中文原因说明；请保留原始错误码和消息，结合 TikTok SDK 或服务端日志排查。';
  return null;
}
