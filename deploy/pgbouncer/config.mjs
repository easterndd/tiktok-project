const poolSettings = {
  maxClientConn: 300,
  defaultPoolSize: 4,
  reservePoolSize: 2,
  reservePoolTimeout: 1,
  maxUserConnections: 60
};

export function renderPgBouncerConfig(database, schemas) {
  if (!/^[A-Za-z0-9_]+$/.test(database)) throw new Error('Invalid PgBouncer database name.');
  if (!schemas.includes('public') || schemas.some((schema) => !/^[A-Za-z0-9_]+$/.test(schema))) {
    throw new Error('Unexpected database schema for PgBouncer.');
  }

  const databases = schemas
    .map((schema) => `${database}__${schema} = host=postgres port=5432 dbname=${database} connect_query='SET search_path TO "${schema}"'`)
    .join('\n');

  return `[databases]
${databases}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /opt/pooler/users.txt
pool_mode = transaction
ignore_startup_parameters = search_path
max_client_conn = ${poolSettings.maxClientConn}
default_pool_size = ${poolSettings.defaultPoolSize}
reserve_pool_size = ${poolSettings.reservePoolSize}
reserve_pool_timeout = ${poolSettings.reservePoolTimeout}
max_user_connections = ${poolSettings.maxUserConnections}
max_prepared_statements = 100
server_idle_timeout = 5
log_connections = 0
log_disconnections = 0
`;
}
