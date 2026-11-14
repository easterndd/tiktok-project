const sensitiveKey = /(?:authorization|cookie|token|secret|password|auth.?code|openid|open_id|ttclid|ttoclid|click_id|signature|signed.?url|session.?id|user.?id|email|phone)/i;

function redactText(value: string) {
  return value.replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:token|secret|password|auth.?code|ttclid|ttoclid|click_id|signature)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 1_000);
}

export function safeDebugValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[Function]';
  if (typeof value === 'symbol') return String(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 4) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeDebugValue(item, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
    if (sensitiveKey.test(key)) output[key] = '[REDACTED]';
    else if (key.toLowerCase() === 'access-control-allow-origin' && typeof item === 'string') {
      try { output[key] = item === '*' ? '*' : new URL(item).origin; }
      catch { output[key] = '[REDACTED]'; }
    } else output[key] = safeDebugValue(item, depth + 1);
  }
  return output;
}

export function boundedDebugValue(value: unknown, maxLength = 4_096): unknown {
  if (value === undefined) return undefined;
  try {
    const sanitized = safeDebugValue(value);
    const serialized = JSON.stringify(sanitized);
    if (!serialized) return undefined;
    return serialized.length <= maxLength ? sanitized : { truncated: true, preview: serialized.slice(0, maxLength) };
  } catch {
    return '[UNAVAILABLE]';
  }
}

export function debugQueryParams(url: URL) {
  const params: Record<string, string | string[]> = {};
  url.searchParams.forEach((item, key) => {
    const value = sensitiveKey.test(key) ? '[REDACTED]' : redactText(item);
    const previous = params[key];
    params[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  });
  return params;
}

export function debugHeaders(headers: Headers) {
  const values = Object.fromEntries(headers.entries());
  const allowOrigin = values['access-control-allow-origin'];
  const sanitized = safeDebugValue(values) as Record<string, unknown>;
  if (allowOrigin) {
    try { sanitized['access-control-allow-origin'] = allowOrigin === '*' ? '*' : new URL(allowOrigin).origin; }
    catch { sanitized['access-control-allow-origin'] = '[REDACTED]'; }
  }
  return sanitized;
}

export function debugRequestTarget(requestUrl: string, pageOrigin: string) {
  try {
    const url = new URL(requestUrl, pageOrigin);
    return { url: url.origin + url.pathname, apiOrigin: url.origin, crossOrigin: url.origin !== pageOrigin };
  } catch {
    return { url: requestUrl.split(/[?#]/, 1)[0] };
  }
}

export function debugResponseDetails(response: Response | undefined, body?: unknown) {
  if (!response) return {};
  const apiError = response.status >= 400 && body && typeof body === 'object' && 'error' in body
    ? (body as { error?: unknown }).error : undefined;
  const error = apiError && typeof apiError === 'object' ? apiError as { code?: unknown; message?: unknown } : undefined;
  return {
    statusText: response.statusText,
    requestId: response.headers.get('x-request-id'),
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length'),
    serverTiming: response.headers.get('server-timing'),
    retryAfter: response.headers.get('retry-after'),
    rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
    ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}),
    ...(typeof error?.message === 'string' ? { errorMsg: error.message } : {}),
    responseHeaders: boundedDebugValue(debugHeaders(response.headers)),
    responseBody: boundedDebugValue(body)
  };
}
