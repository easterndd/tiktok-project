export function runtimeDatabaseUrl(databaseUrl: string, poolerHost?: string, poolerPort = 6432) {
  if (!poolerHost) return databaseUrl;
  const url = new URL(databaseUrl);
  url.hostname = poolerHost;
  url.port = String(poolerPort);
  const schema = url.searchParams.get('schema') || 'public';
  if (!/^[A-Za-z0-9_]+$/.test(schema)) throw new Error('Invalid database schema for pooled connection.');
  url.pathname = `${url.pathname}__${schema}`;
  url.searchParams.set('connection_limit', '3');
  url.searchParams.set('pool_timeout', '20');
  return url.toString();
}
