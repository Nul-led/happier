import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

test('preserved Android submit uses dependency-free canonical app identity and selected submit profile', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'happier-aab-retry-'));
  const workspace = path.join(dir, 'submit');
  const aab = path.join(dir, 'candidate.aab');
  writeFileSync(aab, 'preserved-aab');
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/pipeline/expo/prepare-static-submit-workspace.mjs'),
    '--environment', 'production', '--profile', 'production', '--out-dir', workspace,
  ], { cwd: repoRoot });
  const app = JSON.parse(readFileSync(path.join(workspace, 'app.json'), 'utf8'));
  const eas = JSON.parse(readFileSync(path.join(workspace, 'eas.json'), 'utf8'));
  const canonical = JSON.parse(readFileSync(path.join(repoRoot, 'apps/ui/eas.json'), 'utf8'));
  assert.equal(app.expo.android.package, 'dev.happier.app');
  assert.deepEqual(eas.submit.production.android, canonical.submit.production.android);
  assert.equal(JSON.parse(readFileSync(path.join(workspace, 'package.json'), 'utf8')).dependencies, undefined);
  const out = execFileSync(process.execPath, [path.join(repoRoot, 'scripts/pipeline/run.mjs'), 'expo-submit',
    '--environment', 'production', '--platform', 'android', '--profile', 'production',
    '--project-dir', workspace, '--path', aab, '--dry-run', '--secrets-source', 'env',
  ], { cwd: repoRoot, env: { ...process.env, CI: 'true', EXPO_TOKEN: '' }, encoding: 'utf8' });
  assert.ok(out.includes(`(cwd: ${workspace})`));
  assert.ok(out.includes(`--path ${aab}`));
  assert.doesNotMatch(out, /--latest/);
});
