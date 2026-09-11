import type { UiComponent, UiComponentKey } from '@breezereels/shared-types';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { defaultUiComponents } from './defaults';

export function useUiComponents() {
  return useQuery({
    queryKey: ['ui-components'],
    queryFn: () => apiClient.get<{ items: UiComponent[] }>('/ui-components'),
    placeholderData: { items: defaultUiComponents },
    staleTime: 15_000
  });
}

export function componentIsEnabled(components: UiComponent[] | undefined, key: UiComponentKey) {
  return components?.find((component) => component.key === key)?.enabled ?? true;
}
