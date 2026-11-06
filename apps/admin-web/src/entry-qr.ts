type BarcodeScannerWindow = Window & {
  BarcodeDetector?: new (options?: { formats?: string[] }) => {
    detect(source: ImageBitmap): Promise<Array<{ rawValue: string }>>;
  };
};

function minisLink(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:'
      && (url.hostname === 'www.tiktok.com' || url.hostname === 'tiktok.com')
      && /^\/minis\/[^/]+\/?$/.test(url.pathname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function decodeEntryQr(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
    throw new Error('请选择不超过 10 MB 的二维码图片。');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const Detector = (window as BarcodeScannerWindow).BarcodeDetector;
    if (Detector) {
      try {
        const results = await new Detector({ formats: ['qr_code'] }).detect(bitmap);
        const link = results.map((result) => minisLink(result.rawValue)).find(Boolean);
        if (link) return link;
      } catch { /* Native detection is optional; use the local decoder below. */ }
    }

    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('浏览器无法读取二维码图片。');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import('jsqr');
    const decoded = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
    const link = decoded && minisLink(decoded.data);
    if (!link) throw new Error('未识别到有效的 TikTok Minis 入口链接，请换一张清晰的二维码图片。');
    return link;
  } finally {
    bitmap.close();
  }
}
