import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { renderPgBouncerConfig } from './config.mjs';

const { POSTGRES_DB: database, POSTGRES_USER: user, POSTGRES_PASSWORD: password } = process.env;
if (!database || !user || !password || !/^[A-Za-z0-9_]+$/.test(database) || !/^[A-Za-z0-9_]+$/.test(user)) {
  throw new Error('Invalid PgBouncer database configuration.');
}
if (/[\r\n]/.test(password)) throw new Error('PgBouncer password cannot contain line breaks.');

const quotedPassword = password.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
writeFileSync('/opt/pooler/users.txt', `"${user}" "${quotedPassword}"\n`, { mode: 0o600 });
const schemasResult = spawnSync('psql', ['-h', 'postgres', '-U', user, '-d', database, '-Atc',
  "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname"],
{ encoding: 'utf8', env: { ...process.env, PGPASSWORD: password } });
if (schemasResult.status !== 0) throw new Error(`Cannot discover PgBouncer schemas: ${schemasResult.stderr}`);
const schemas = schemasResult.stdout.trim().split('\n');
writeFileSync('/opt/pooler/pgbouncer.ini', renderPgBouncerConfig(database, schemas), { mode: 0o600 });

const child = spawn('pgbouncer', ['/opt/pooler/pgbouncer.ini'], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
