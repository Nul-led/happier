import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function jobIds(raw) {
  const jobs = raw.slice(raw.indexOf('\njobs:'));
  return [...jobs.matchAll(/^  ([A-Za-z0-9_-]+):$/gm)].map((m) => m[1]).filter((id) => id !== 'ci_summary');
}

test('tests workflow summary covers every top-level CI lane', async () => {
  const raw = await readFile(join(process.cwd(), '.github/workflows/tests.yml'), 'utf8');
  const collector = await readFile(join(process.cwd(), 'scripts/release/ciSummaryCollector.mjs'), 'utf8');
  const summary = raw.match(/\n  ci_summary:[\s\S]*?\n  [A-Za-z0-9_-]+:/)?.[0] ?? raw.slice(raw.indexOf('\n  ci_summary:'));
  const needs = summary.match(/needs: \[([^\]]+)\]/)?.[1]?.split(',').map((id) => id.trim()).filter(Boolean) ?? [];
  assert.ok(needs.length > 0, 'ci_summary must declare its lane dependencies');
  assert.deepEqual(new Set(needs), new Set(jobIds(raw)), 'ci_summary.needs must stay synchronized with every top-level CI lane');
  assert.match(summary, /from '\.\/scripts\/release\/ciSummaryCollector\.mjs'/, 'workflow must reuse the canonical summary collector');
  assert.match(summary, /collectCiSummary\(\{ needs, requiredJobs: requiredLanes \}\)/, 'workflow must pass its observed jobs to the collector');
  assert.match(collector, /result !== 'success' && result !== 'skipped'/, 'collector must fail closed for every non-success non-required lane result');
  assert.match(collector, /result !== 'success' \|\| outputs\.command_executed === 'false'/, 'selected lanes must both succeed and execute their guarded command');
  assert.doesNotMatch(collector, /\["failure","cancelled"\]\.includes\(v\.result\)/, 'collector must not ignore timeout/startup/stale conclusions');
  assert.match(raw, /ci-summary\.json/, 'collector must write a machine-readable summary artifact');
  assert.match(raw, /name: Upload machine-readable CI summary[\s\S]*?if: always\(\)/, 'summary artifact must upload even when a lane fails');
});

test('CLI matrix runs unit-only extras once while both unit and integration partitions remain required', async () => {
  const raw = await readFile(join(process.cwd(), '.github/workflows/tests.yml'), 'utf8');
  const packageJson = JSON.parse(await readFile(join(process.cwd(), 'apps/cli/package.json'), 'utf8'));
  const cliJob = raw.match(/\n  cli:[\s\S]*?\n  stack:/)?.[0] ?? '';

  assert.match(cliJob, /if \[ "\$\{\{ matrix\.part \}\}" = "1" \]; then[\s\S]*?yarn workspace @happier-dev\/cli test:unit[\s\S]*?else[\s\S]*?yarn workspace @happier-dev\/cli test:unit:vitest/);
  assert.match(cliJob, /name: Run integration tests[\s\S]*?yarn workspace @happier-dev\/cli test:integration/);
  assert.doesNotMatch(cliJob, /name: Run integration tests[\s\S]*?matrix\.part == 1/);
  assert.match(packageJson.scripts?.['test:unit:local'] ?? '', /test:unit:vitest:local/);
  assert.doesNotMatch(packageJson.scripts?.['test:unit:vitest:local'] ?? '', /test:import-cycles|prepack-script|stageManagedRuntimeArchives|runWorkspaceSyncRealIntegration/);
});
