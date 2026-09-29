import { newMiniApps } from './app-catalog';

const names = { main: 'QuicK ReeLS', taletv: 'TaleTV', ...newMiniApps } as const;
const configuredKey = import.meta.env.VITE_APP_KEY;
export const appKey = typeof configuredKey === 'string' && configuredKey in names ? configuredKey as keyof typeof names : 'main';
export const appName = import.meta.env.VITE_APP_NAME || names[appKey];
export const storagePrefix = appKey === 'main' ? 'quickreels' : appKey;
