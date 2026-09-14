import type { Locale } from '@quickreels/shared-types';
import { useSyncExternalStore } from 'react';
import { detectLocale } from './i18n';

const validLocales = new Set(['en', 'pt', 'fr', 'id', 'ja', 'es', 'ko', 'th']);

const sessionKey = 'quickreels_access_token';
const sessionListeners = new Set<() => void>();

export function getStoredLocale(): Locale {
  const stored = localStorage.getItem('quickreels_locale');
  return stored && validLocales.has(stored) ? stored as Locale : detectLocale();
}

export function setStoredLocale(locale: Locale) {
  localStorage.setItem('quickreels_locale', locale);
  localeListeners.forEach((listener) => listener());
}

const localeListeners = new Set<() => void>();
export function subscribeToLocale(listener: () => void) {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

export function useLocale() {
  return useSyncExternalStore(subscribeToLocale, getStoredLocale, () => 'en' as Locale);
}

export function getSessionToken() {
  return sessionStorage.getItem(sessionKey);
}

export function setSessionToken(token: string) {
  sessionStorage.setItem(sessionKey, token);
  sessionListeners.forEach((listener) => listener());
}

export function clearSessionToken() {
  sessionStorage.removeItem(sessionKey);
  sessionListeners.forEach((listener) => listener());
}

export function subscribeToSession(listener: () => void) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function isDemoMode() {
  return import.meta.env.VITE_DEMO_MODE !== 'false';
}
