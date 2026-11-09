export type AdFailureAction = 'STOP' | 'WAIT_FOREGROUND' | 'RECREATE_ONCE' | 'TRY_BACKUP_ONCE';
export type AdErrorOrigin = 'SDK_CALLBACK' | 'SDK_PROMISE' | 'APP_TIMEOUT' | 'API_HTTP' | 'UNKNOWN';

export function taggedAdFailure(message: string, origin: AdErrorOrigin) {
  return Object.assign(new Error(message), { adErrorOrigin: origin });
}

export function classifyAdFailure(error: unknown, origin: AdErrorOrigin = 'UNKNOWN'): AdFailureAction {
  let text: string;
  if (error instanceof Error) text = error.message;
  else if (typeof error === 'string') text = error;
  else {
    try { text = JSON.stringify(error ?? '') ?? ''; } catch { text = String(error ?? ''); }
  }
  const value = text.toLowerCase();
  if (/not in the foreground|not foreground|background/.test(value)) return 'WAIT_FOREGROUND';
  if (/11006|already.*(show|display)|ad.*active/.test(value)) return 'STOP';
  if (/11002|invalid.*(ad|instance)/.test(value)) return 'RECREATE_ONCE';
  if (origin === 'SDK_CALLBACK' || origin === 'SDK_PROMISE') {
    if (/no[\s_-]?fill|no inventory|no ad available|ad not filled/.test(value)) return 'TRY_BACKUP_ONCE';
  }
  return 'STOP';
}

export function normalizeErrorOrigin(error: unknown, callbackName?: string): AdErrorOrigin {
  if (error && typeof error === 'object' && 'adErrorOrigin' in error) {
    const origin = (error as { adErrorOrigin?: unknown }).adErrorOrigin;
    if (origin === 'SDK_CALLBACK' || origin === 'SDK_PROMISE' || origin === 'APP_TIMEOUT' || origin === 'API_HTTP') return origin;
  }
  if (error && typeof error === 'object' && 'status' in error && typeof (error as { status?: unknown }).status === 'number') return 'API_HTTP';
  if (error instanceof Error && /AD_(?:SHOW|CLOSE|LOAD)_TIMEOUT/.test(error.message)) return 'APP_TIMEOUT';
  if (callbackName === 'onError') return 'SDK_CALLBACK';
  if (callbackName === 'show.reject' || callbackName === 'load.reject') return 'SDK_PROMISE';
  return 'UNKNOWN';
}
