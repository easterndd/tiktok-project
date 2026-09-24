export const appKey = import.meta.env.VITE_APP_KEY === 'taletv' ? 'taletv' : 'main';
export const appName = import.meta.env.VITE_APP_NAME || (appKey === 'taletv' ? 'TaleTV' : 'QuicK ReeLS');
export const storagePrefix = appKey === 'taletv' ? 'taletv' : 'quickreels';
