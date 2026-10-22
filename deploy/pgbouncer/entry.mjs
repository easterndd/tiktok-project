import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const { POSTGRES_DB: database, POSTGRES_USER: user, POSTGRES_PASSWORD: password } = process.env;
if (!database || !user || !password || !/^[A-Za-z0-9_]+$/.test(database) || !/^[A-Za-z0-9_]+$/.test(user)) {
  throw new Error('Invalid PgBouncer database configuration.');
}
if (/[\n]/.test(password)) throw new Error('PgBouncer password cannot contain line breaks.');

const quotedPassword = password.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
writeFileSync('/opt/pooler/users.txt', `"${user}" "${quotedPassword}"\n`, { mode: 0o600 });
const schemasResult = spawnSync('psql', ['-h', 'postgres', '-U', user, '-d', database, '-Atc',
  "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname"],
{ encoding: 'utf8', env: { ...process.env, PGPASSWORD: password } });
if (schemasResult.status !== 0) throw new Error(`Cannot discover PgBouncer schemas: ${schemasResult.stderr}`);
const schemas = schemasResult.stdout.trim().split('\n');
if (!schemas.includes('public') || schemas.some((schema) => !/^[A-Za-z0-9_]+$/.test(schema))) {
  throw new Error('Unexpected database schema for PgBouncer.');
}
const databases = schemas.map((schema) => `${database}__${schema} = host=postgres port=5432 dbname=${database} connect_query='SET search_path TO "${schema}"'`).join('\n');
writeFileSync('/opt/pooler/pgbouncer.ini', `[databases]
${databases}

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = scram-sha-256
auth_file = /opt/pooler/users.txt
pool_mode = transaction
ignore_startup_parameters = search_path
max_client_conn = 300
default_pool_size = 3
reserve_pool_size = 1
reserve_pool_timeout = 3
max_user_connections = 50
max_prepared_statements = 100
server_idle_timeout = 5
log_connections = 0
log_disconnections = 0
`, { mode: 0o600 });

const child = spawn('pgbouncer', ['/opt/pooler/pgbouncer.ini'], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
