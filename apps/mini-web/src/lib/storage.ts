import type { Locale } from '@quickreels/shared-types';
import { useSyncExternalStore } from 'react';
import { detectLocale } from './i18n';
import { storagePrefix } from './app-brand';

const validLocales = new Set(['en', 'pt', 'fr', 'id', 'ja', 'es', 'ko', 'th']);

const sessionKey = `${storagePrefix}_access_token`;
const visitorKey = `${storagePrefix}_visitor_key`;
const localeKey = `${storagePrefix}_locale`;
const sessionListeners = new Set<() => void>();

if (storagePrefix === 'taletv') {
  for (const suffix of ['visitor_key', 'locale']) {
    const oldKey = `xu03_${suffix}`;
    const nextKey = `${storagePrefix}_${suffix}`;
    const saved = localStorage.getItem(oldKey);
    if (saved !== null) {
      if (localStorage.getItem(nextKey) === null) localStorage.setItem(nextKey, saved);
      localStorage.removeItem(oldKey);
    }
  }
  sessionStorage.removeItem('xu03_access_token');
}

export function getStoredLocale(): Locale {
  const stored = localStorage.getItem(localeKey);
  return stored && validLocales.has(stored) ? stored as Locale : detectLocale();
}

export function setStoredLocale(locale: Locale) {
  localStorage.setItem(localeKey, locale);
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

export function getOrCreateVisitorKey() {
  const stored = localStorage.getItem(visitorKey);
  if (stored) return stored;
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(visitorKey, value);
  return value;
}

export function subscribeToSession(listener: () => void) {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function isDemoMode() {
  return import.meta.env.VITE_DEMO_MODE !== 'false';
}
