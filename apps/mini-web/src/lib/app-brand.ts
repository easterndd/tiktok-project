export const appKey = import.meta.env.VITE_APP_KEY === 'xu03' ? 'xu03' : 'main';
export const appName = import.meta.env.VITE_APP_NAME || (appKey === 'xu03' ? 'TaleTV' : 'QuicK ReeLS');
export const storagePrefix = appKey === 'xu03' ? 'xu03' : 'quickreels';
