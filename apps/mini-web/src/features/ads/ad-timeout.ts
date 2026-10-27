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
    const detail = error as { errMsg?: unknown; message?: unknown; errCode?: unknown; code?: unknown; error_code?: unknown; error_msg?: unknown; sub_error_code?: unknown; error_extra?: unknown };
    const code = detail.error_code ?? detail.errCode ?? detail.code;
    const message = detail.error_msg ?? detail.errMsg ?? detail.message;
    const subCode = detail.sub_error_code;
    const extra = detail.error_extra;
    return [code, subCode, message, extra].filter((value) => value != null).map(String).join(': ').slice(0, 500) || 'AD_SHOW_FAILED';
  }
  return String(error ?? 'AD_SHOW_FAILED').slice(0, 500);
}
