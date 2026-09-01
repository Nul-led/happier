import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('canonical Docker publisher builds the stock Iroh relay with SBOM and provenance', () => {
  const repoRoot = process.cwd();
  const out = execFileSync(process.execPath, [
    path.join(repoRoot, 'scripts/pipeline/docker/publish-images.mjs'),
    '--channel', 'dev',
    '--registries', 'dockerhub',
    '--dry-run',
    '--build-relay', 'false',
    '--build-dev-box', 'false',
    '--build-iroh-relay', 'true',
  ], {
    cwd: repoRoot,
    env: { ...process.env, GITHUB_ACTIONS: 'false' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  assert.match(out, /docker buildx build/);
  assert.match(out, /--file\s+deploy\/iroh-relay\/Dockerfile/);
  assert.match(out, /--tag\s+happierdev\/iroh-relay:dev\b/);
  assert.match(out, /--sbom=true/);
  assert.match(out, /--provenance=true/);
  assert.match(out, /deploy\/iroh-relay(?:\s|$)/);
  assert.doesNotMatch(out, /--target\s+relay-server/);
});
