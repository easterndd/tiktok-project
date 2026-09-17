import type { FastifyRequest } from 'fastify';
import type { AdminRole } from '@prisma/client';

export type AdminPermission = 'admin.manage' | 'ads.read' | 'ads.write' | 'analytics.read' | 'audit.read' | 'content.read' | 'content.write' | 'settings.read' | 'settings.write';

const permissionsByRole: Record<AdminRole, ReadonlySet<AdminPermission | '*'> > = {
  OWNER: new Set(['*']),
  EDITOR: new Set(['content.read', 'content.write', 'ads.read', 'ads.write', 'analytics.read', 'settings.read', 'settings.write']),
  ANALYST: new Set(['content.read', 'ads.read', 'analytics.read', 'audit.read', 'settings.read']),
  SUPPORT: new Set(['content.read', 'ads.read', 'analytics.read'])
};

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; kind: 'user' | 'admin'; role?: AdminRole; tokenVersion?: number };
    user: { sub: string; kind: 'user' | 'admin'; role?: AdminRole; tokenVersion?: number };
  }
}

export async function requireUser(request: FastifyRequest) {
  await request.jwtVerify();
  if (request.user.kind !== 'user') throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

function permissionForRequest(request: FastifyRequest): AdminPermission {
  const path = request.routeOptions.url ?? request.url.split('?')[0];
  if (path.startsWith('/admin/admin-users')) return 'admin.manage';
  if (path.startsWith('/admin/audit-logs')) return 'audit.read';
  if (path.startsWith('/admin/analytics')) return 'analytics.read';
  if (path.startsWith('/admin/app-entry-ad-policy')) return request.method === 'GET' ? 'ads.read' : 'ads.write';
  if (path.startsWith('/admin/ui-components')) return request.method === 'GET' ? 'settings.read' : 'settings.write';
  return request.method === 'GET' ? 'content.read' : 'content.write';
}

function forbidden() {
  return Object.assign(new Error('Forbidden'), { statusCode: 403 });
}

export async function requireAdmin(request: FastifyRequest) {
  await request.jwtVerify();
  if (request.user.kind !== 'admin' || request.user.tokenVersion === undefined) throw forbidden();
  const admin = await request.server.prisma.adminUser.findUnique({
    where: { id: request.user.sub },
    select: { role: true, status: true, tokenVersion: true }
  });
  if (!admin || admin.status !== 'ACTIVE' || admin.tokenVersion !== request.user.tokenVersion) throw forbidden();
  if (!permissionsByRole[admin.role].has('*') && !permissionsByRole[admin.role].has(permissionForRequest(request))) throw forbidden();
  request.user.role = admin.role;
}

export function requirePermission(permission: AdminPermission) {
  return async (request: FastifyRequest) => {
    await requireAdmin(request);
    const role = request.user.role;
    if (!role || (!permissionsByRole[role].has('*') && !permissionsByRole[role].has(permission))) throw forbidden();
  };
}
