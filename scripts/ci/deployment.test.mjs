import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectRun, assertJobs } from './verify-ci.mjs';
import { format } from 'prettier';
const sha = 'a'.repeat(40), repository = 'owner/repo';
const success = { id: 10, head_sha: sha, head_branch: 'main', event: 'push', head_repository: { full_name: repository }, status: 'completed', conclusion: 'success' };
test('CI authorization binds exact commit, branch, repository and event', () => {
  assert.equal(selectRun([success], sha, repository).id, 10);
  for (const change of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'feature' }, { event: 'pull_request' }, { head_repository: { full_name: 'fork/repo' } }, { conclusion: 'failure' }, { status: 'in_progress' }]) {
    assert.throws(() => selectRun([{ ...success, ...change }], sha, repository));
  }
  assert.throws(() => selectRun([success, { ...success, id: 11, conclusion: 'failure' }], sha, repository));
});
test('all mandatory CI jobs must succeed; skipped or missing is not success', () => {
  const jobs = ['quality', 'browser', 'docker'].map(name => ({ name, status: 'completed', conclusion: 'success' }));
  assertJobs(jobs);
  assert.throws(() => assertJobs(jobs.slice(1)));
  assert.throws(() => assertJobs(jobs.map(j => ({ ...j, conclusion: 'skipped' }))));
});
test('workflows pin actions; production is manual and protected', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const cd = readFileSync('.github/workflows/deploy-production.yml', 'utf8');
  for (const text of [ci, cd]) for (const match of text.matchAll(/uses:\s+([^\s]+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
  assert.match(cd, /workflow_dispatch:/);
  assert.doesNotMatch(cd, /^  (push|pull_request|workflow_run):/m);
  assert.match(cd, /environment: production/);
  assert.match(cd, /cancel-in-progress: false/);
  assert.match(cd, /secrets\.SSH_KNOWN_HOSTS \|\| secrets\.VPS_KNOWN_HOSTS/);
  assert.doesNotMatch(cd, /StrictHostKeyChecking=no|continue-on-error/);
});
test('workflow and production/test Compose YAML parse correctly', async () => {
  for (const path of ['.github/workflows/ci.yml', '.github/workflows/deploy-production.yml', 'docker-compose.prod.yml', 'docker-compose.public-test.yml']) {
    await format(readFileSync(path, 'utf8'), { parser: 'yaml' });
  }
});
test('production manifest isolates TLS Redis and exposes only the loopback gateway', () => {
  const compose = readFileSync('docker-compose.prod.yml', 'utf8');
  assert.match(compose, /127\.0\.0\.1:5020:8080/);
  assert.doesNotMatch(compose, /^  mongo:/m);
  assert.match(compose, /internal: true/);
  assert.match(compose, /NODE_EXTRA_CA_CERTS:/);
  assert.equal((compose.match(/ports:/g) ?? []).length, 1);
  assert.doesNotMatch(compose, /docker\.sock|external: true|0\.0\.0\.0/);
  assert.match(compose, /bookmybus-crs_integration/);
  assert.match(compose, /networks: \[edge, data\]/);
  assert.match(compose, /integration:\s*\n\s+aliases: \[bookmybus-redis\]/);
  assert.match(compose, /integration: \{\}/);
  const publicTest = readFileSync('docker-compose.public-test.yml', 'utf8');
  assert.match(publicTest, /NODE_ENV: staging/);
  assert.match(publicTest, /PUBLIC_API_SANDBOX: "true"/);
  assert.match(publicTest, /FINANCE_TEST_MODE: "true"/);
  assert.match(publicTest, /REDIS_PREFIX: aibus:public-test/);
  assert.match(publicTest, /bookmybus-crs_integration/);
  assert.match(publicTest, /external: true/);
  assert.match(publicTest, /networks: \[integration, egress\]/);
  assert.doesNotMatch(publicTest, /bookmybus-crs_(?:edge|data)/);
  assert.doesNotMatch(publicTest, /^\s+ports:/m);
  assert.doesNotMatch(publicTest, /APP_ENV_FILE|REDIS_TLS_DIR/);
  const backend = readFileSync('backend/src/server.ts', 'utf8');
  assert.match(backend, /config\.REDIS_PREFIX}:limit:/);
  assert.match(backend, /config\.REDIS_PREFIX}:socket\.io/);
  const gateway = readFileSync('deploy/nginx/gateway.conf', 'utf8');
  const route = readFileSync('deploy/nginx/public-test-proxy.inc', 'utf8');
  assert.match(gateway, /location \^~ \/api\/v1\/public\//);
  assert.match(gateway, /if \(\$host != partner\.bookmybus\.pro\) \{ return 404; \}/);
  assert.match(route, /set \$public_test_api public-test-api:4000/);
  assert.match(route, /resolver 127\.0\.0\.11/);
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  assert.match(dockerfile, /COPY deploy\/nginx\/public-test-proxy\.inc/);
  const script = readFileSync('scripts/release-common.sh', 'utf8');
  assert.match(script, /-p "\$PROJECT"/);
  assert.doesNotMatch(script, /docker (system prune|volume rm)|down -v/);
  const transfer = readFileSync('scripts/ci/ssh-deploy.sh', 'utf8');
  assert.match(transfer, /docker-compose\.public-test\.yml/);
  assert.match(transfer, /deploy\/public-api-test-compose\.env\.example/);
});
