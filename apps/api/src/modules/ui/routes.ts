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

function mergeUiComponents(items: UiComponent[]): UiComponent[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  return defaultUiComponents.map((component) => {
    const stored = byKey.get(component.key);
    return {
      ...component,
      page: stored?.page ?? component.page,
      enabled: stored?.enabled ?? component.enabled,
      config: stored?.config ?? null
    };
  });
}

export async function registerUiRoutes(app: FastifyInstance) {
  app.get('/ui-components', async (request, reply): Promise<{ items: UiComponent[]; version: number } | void> => {
    const published = await app.prisma.uiConfigVersion.findFirst({ where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    const version = published?.version ?? 0;
    const etag = `"ui-components-${version}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, max-age=30');
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();

    if (published && Array.isArray(published.content)) {
      const items = (published.content as unknown[])
        .filter((component): component is Record<string, unknown> => Boolean(component) && typeof component === 'object')
        .filter((component) => typeof component.key === 'string' && typeof component.page === 'string' && typeof component.enabled === 'boolean')
        .map((component) => ({
          key: component.key as UiComponentKey,
          page: component.page as UiComponent['page'],
          enabled: component.enabled as boolean,
          config: (component.config as Record<string, unknown> | null | undefined) ?? null
        }));
      return { items: mergeUiComponents(items), version };
    }

    const components = await app.prisma.uiComponent.findMany({ orderBy: { key: 'asc' } });
    return {
      items: mergeUiComponents(components.map((component) => ({
        key: component.key as UiComponentKey,
        page: component.page as UiComponent['page'],
        enabled: component.enabled,
        config: (component.config as Record<string, unknown> | null) ?? null
      }))),
      version
    };
  });
}
