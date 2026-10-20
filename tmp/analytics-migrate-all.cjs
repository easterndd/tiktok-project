const { spawnSync } = require('node:child_process');
const { loadEnv } = require('./dist/config/env');
const { configuredMiniAppKeys, miniAppEnvironment } = require('./dist/config/mini-apps');

const env = { ...loadEnv(), MINI_APP_KEY: 'main' };
const keys = configuredMiniAppKeys(env);
let failed = false;
for (const key of keys) {
  const context = miniAppEnvironment(env, key);
  if (!context) continue;
  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: context.DATABASE_URL },
    encoding: 'utf8', timeout: 120_000
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  console.log(`${key}: ${result.status === 0 ? 'OK' : 'FAILED'} ${/Applying migration `20261016020000_analytics_daily_summary`/.test(output) ? 'applied' : 'already current'}`);
  if (result.status !== 0) {
    failed = true;
    console.error(output.replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, 'postgresql://***@').slice(-1500));
  }
}
if (failed) process.exitCode = 1;
