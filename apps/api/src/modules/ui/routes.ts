import type { UiComponent, UiComponentKey } from '@quickreels/shared-types';
import type { FastifyInstance } from 'fastify';

export const defaultUiComponents: UiComponent[] = [
  { key: 'APP_TOPBAR', page: 'APP', enabled: true },
  { key: 'APP_BOTTOM_NAV', page: 'APP', enabled: true },
  { key: 'HOME_INTRO', page: 'HOME', enabled: true },
  { key: 'HOME_FEED', page: 'HOME', enabled: true },
  { key: 'ALBUM_DESCRIPTION', page: 'ALBUM', enabled: true },
  { key: 'PROFILE_HISTORY', page: 'PROFILE', enabled: true },
  { key: 'PROFILE_FAVORITES', page: 'PROFILE', enabled: true }
];

export async function registerUiRoutes(app: FastifyInstance) {
  app.get('/ui-components', async (): Promise<{ items: UiComponent[] }> => {
    const components = await app.prisma.uiComponent.findMany({ orderBy: { key: 'asc' } });
    return { items: components.length ? components.map((component) => ({ key: component.key as UiComponentKey, page: component.page as UiComponent['page'], enabled: component.enabled, config: (component.config as Record<string, unknown> | null) ?? null })) : defaultUiComponents };
  });
}
