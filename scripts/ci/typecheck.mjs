import { spawnSync } from 'node:child_process';
for (const workspace of ['backend', 'frontend', 'admin', 'partner', 'owner']) {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', `${workspace}/tsconfig.json`, '--noEmit'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const client of ['agent-dashboard', 'public-api']) {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', `integrations/${client}/client.ts`, '--noEmit', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--lib', 'ES2022,DOM', '--skipLibCheck'], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
