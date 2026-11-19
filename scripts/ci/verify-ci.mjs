import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
export function selectRun(runs, sha, repository) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Full commit SHA required');
  const matches = runs.filter(r => r.head_sha === sha && r.head_branch === 'main' && r.event === 'push' && r.head_repository?.full_name === repository);
  matches.sort((a, b) => b.id - a.id);
  const run = matches[0];
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') throw Error('Latest push CI for the exact main commit must have succeeded');
  return run;
}
export function assertJobs(jobs) {
  for (const name of ['quality', 'browser', 'docker']) {
    if (!jobs.some(j => j.name === name && j.status === 'completed' && j.conclusion === 'success')) throw Error(`Required successful CI job missing: ${name}`);
  }
}
async function main() {
  if (process.env.CONFIRMATION !== 'DEPLOY' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw Error('Manual DEPLOY from main is required');
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) throw Error('Invalid repository');
  const request = async path => {
    const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, { headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!response.ok) throw Error(`GitHub CI verification failed (${response.status})`);
    return response.json();
  };
  const sha = process.env.GITHUB_SHA;
  const { workflow_runs } = await request(`actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&per_page=100`);
  const run = selectRun(workflow_runs, sha, repository);
  assertJobs((await request(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`)).jobs);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\nci_run=${run.id}\n`);
  console.log(`Verified exact-commit CI run ${run.id}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
