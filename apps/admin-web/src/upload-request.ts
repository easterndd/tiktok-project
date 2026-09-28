export type UploadProgress = { phase: 'sending'; percent: number } | { phase: 'processing' };

export class UploadRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function parseResponse(text: string): { error?: { message?: string } } | null {
  try { return JSON.parse(text) as { error?: { message?: string } }; }
  catch { return null; }
}

export function uploadMultipart<T>(
  url: string,
  body: FormData,
  token: string | null,
  onProgress: (progress: UploadProgress) => void,
  xhrFactory: () => XMLHttpRequest = () => new XMLHttpRequest()
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open('POST', url);
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress({ phase: 'sending', percent: Math.min(100, Math.round(event.loaded / event.total * 100)) });
      }
    });
    xhr.upload.addEventListener('load', () => onProgress({ phase: 'processing' }));
    xhr.addEventListener('load', () => {
      const response = parseResponse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        if (response === null) reject(new UploadRequestError('上传接口返回空响应，请检查上传任务状态后再重试。', xhr.status));
        else resolve(response as T);
      }
      else reject(new UploadRequestError(response?.error?.message ?? '请求失败', xhr.status));
    });
    const networkError = () => reject(new UploadRequestError('无法连接后台 API，请检查 API 服务、域名和网络连接。', 0));
    xhr.addEventListener('error', networkError);
    xhr.addEventListener('timeout', networkError);
    xhr.addEventListener('abort', networkError);
    xhr.send(body);
  });
}
