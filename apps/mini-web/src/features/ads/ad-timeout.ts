// Bound SDK calls that never settle or never send a close/error callback.
export function adTimeout(onTimeout: (error: Error) => void) {
  let timer = setTimeout(() => onTimeout(new Error('AD_SHOW_TIMEOUT')), 30_000);
  return {
    shown() {
      clearTimeout(timer);
      timer = setTimeout(() => onTimeout(new Error('AD_CLOSE_TIMEOUT')), 300_000);
    },
    clear() { clearTimeout(timer); }
  };
}

export function adErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const detail = error as { errMsg?: unknown; message?: unknown; errCode?: unknown; code?: unknown };
    return [detail.errCode ?? detail.code, detail.errMsg ?? detail.message].filter((value) => value != null).join(': ').slice(0, 500) || 'AD_SHOW_FAILED';
  }
  return String(error ?? 'AD_SHOW_FAILED').slice(0, 500);
}
