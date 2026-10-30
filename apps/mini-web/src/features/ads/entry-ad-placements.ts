import { storagePrefix } from '../../lib/app-brand';

export type EntryAdPlacementSelection = {
  placementIds: string[];
  index: number;
  placementId: string;
};

type StringStorage = Pick<Storage, 'getItem' | 'setItem'>;

const storageKey = `${storagePrefix}_entry_rewarded_ad_index`;

export function parseEntryAdPlacementIds(value: unknown) {
  if (typeof value !== 'string') return [];
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length !== 2 || ids.some((id) => !/^ad\d+$/.test(id)) || new Set(ids).size !== ids.length) return [];
  return ids;
}

export function getLocalEntryAdPlacementIds() {
  const env = (import.meta as ImportMeta & { env?: ImportMetaEnv }).env;
  return parseEntryAdPlacementIds(env?.VITE_ENTRY_REWARDED_AD_UNIT_IDS);
}

function browserStorage(): StringStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function chooseEntryAdPlacement(placementIds: string[], storage = browserStorage()): EntryAdPlacementSelection | null {
  if (placementIds.length !== 2) return null;
  let index = 0;
  try {
    const saved = Number(storage?.getItem(storageKey));
    if (Number.isInteger(saved) && saved >= 0) index = saved % placementIds.length;
  } catch {
    index = 0;
  }
  return { placementIds, index, placementId: placementIds[index] };
}

export function markEntryAdPlacementAccepted(placementIds: string[], index: number, storage = browserStorage()) {
  if (placementIds.length !== 2 || !Number.isInteger(index) || index < 0 || index >= placementIds.length) return;
  try { storage?.setItem(storageKey, String((index + 1) % placementIds.length)); } catch { /* Rotation is a best-effort preference. */ }
}
