import type { UiComponent, UiComponentKey } from '@quickreels/shared-types';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { defaultUiComponents } from './defaults';
import { storagePrefix } from '../../lib/app-brand';

const uiComponentsCacheKey = `${storagePrefix}_ui_components`;

type UiComponentsResponse = { items: UiComponent[]; version: number };

function readCachedUiComponents(): UiComponentsResponse {
  try {
    const cached = sessionStorage.getItem(uiComponentsCacheKey);
    if (!cached) return { items: defaultUiComponents, version: 0 };
    const parsed = JSON.parse(cached) as UiComponentsResponse;
    if (!Array.isArray(parsed.items) || typeof parsed.version !== 'number') return { items: defaultUiComponents, version: 0 };
    return parsed;
  } catch {
    return { items: defaultUiComponents, version: 0 };
  }
}

export function useUiComponents() {
  return useQuery({
    queryKey: ['ui-components'],
    queryFn: async () => {
      const result = await apiClient.get<UiComponentsResponse>('/ui-components');
      sessionStorage.setItem(uiComponentsCacheKey, JSON.stringify(result));
      return result;
    },
    initialData: readCachedUiComponents,
    staleTime: 15_000
  });
}

export function componentIsEnabled(components: UiComponent[] | undefined, key: UiComponentKey) {
  return components?.find((component) => component.key === key)?.enabled ?? true;
}
