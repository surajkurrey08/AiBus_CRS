import assert from 'node:assert/strict';
import { readConfig } from '../../backend/src/config/env.js';
// Explicit synthetic values only. Never load or connect to the deployment DB.
const good = {
  NODE_ENV: 'production', MONGODB_URI: 'mongodb://ci:synthetic@localhost/aibus?replicaSet=ci',
  REDIS_URL: 'rediss://ci:synthetic@localhost:6379', JWT_SECRET: 'synthetic-ci-key-'.repeat(5),
  PUBLIC_API_JWT_SECRET: 'different-synthetic-ci-key-'.repeat(4),
  WEB_ORIGIN: 'https://bookmybus.pro', ADMIN_WEB_ORIGIN: 'https://admin.bookmybus.pro',
  PARTNER_WEB_ORIGIN: 'https://partner.bookmybus.pro', OWNER_WEB_ORIGIN: 'https://owner.bookmybus.pro', TRUST_PROXY: '2',
};
assert.equal(readConfig(good).NODE_ENV, 'production');
for (const invalid of [
  { REDIS_URL: 'redis://localhost:6379' }, { WEB_ORIGIN: 'http://bookmybus.pro' },
  { MONGODB_URI: 'mongodb://localhost/aibus' }, { FINANCE_TEST_MODE: 'true' },
  { PUBLIC_API_SANDBOX: 'true' }, { JWT_SECRET: 'short' },
]) assert.throws(() => readConfig({ ...good, ...invalid }));
console.log('Production configuration accepts safe settings and rejects unsafe settings (synthetic data only).');
