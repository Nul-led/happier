import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import YAML from 'yaml';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

test('immutable candidate verification retries read-only release downloads without retaining partial bytes', async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'happier-candidate-read-retry-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const binDir = path.join(fixtureRoot, 'bin');
  await mkdir(binDir);
  const outputPath = path.join(fixtureRoot, 'github-output');
  const requestLog = path.join(fixtureRoot, 'requests.log');

  const nodeMock = path.join(binDir, 'node');
  await writeFile(nodeMock, '#!/usr/bin/env bash\nexit 0\n');
  await chmod(nodeMock, 0o755);

  const ghMock = path.join(binDir, 'gh');
  await writeFile(ghMock, `#!/usr/bin/env bash
set -euo pipefail
printf 'download\\n' >> "\$HAPPIER_TEST_REQUEST_LOG"
destination=''
while [ "\$#" -gt 0 ]; do
  if [ "\$1" = --dir ]; then
    destination="\$2"
    break
  fi
  shift
done
test -n "\$destination"
mkdir -p "\$destination"
count="\$(wc -l < "\$HAPPIER_TEST_REQUEST_LOG" | tr -d ' ')"
if [ "\$count" -eq 1 ]; then
  printf 'partial-bytes' > "\$destination/happier-cli.tar.gz"
  printf 'unexpected end of JSON input\\n' >&2
  exit 1
fi
printf 'complete-candidate-bytes' > "\$destination/happier-cli.tar.gz"
: > "\$destination/checksums-happier-v0.3.0-preview.1.txt"
: > "\$destination/checksums-happier-v0.3.0-preview.1.txt.minisig"
`);
  await chmod(ghMock, 0o755);

  const action = YAML.parse(await readFile(
    path.join(repoRoot, '.github', 'actions', 'verify-immutable-release-candidate', 'action.yml'),
    'utf8',
  ));
  const downloadStep = action.runs.steps.find((step) => step.id === 'download');
  assert.ok(downloadStep?.run);
  const result = spawnSync('bash', ['-c', downloadStep.run], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      GITHUB_OUTPUT: outputPath,
      GITHUB_WORKSPACE: repoRoot,
      RUNNER_TEMP: fixtureRoot,
      REPOSITORY: 'happier-dev/happier',
      RELEASE_CHANNEL: 'preview',
      CANDIDATE_SOURCE_SHA: 'a'.repeat(40),
      CANDIDATE_PRODUCT: 'cli',
      CANDIDATE_VERSION: '0.3.0-preview.1',
      HAPPIER_GITHUB_READ_RETRY_DELAY_SECONDS: '0',
      HAPPIER_TEST_REQUEST_LOG: requestLog,
    },
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const githubOutput = await readFile(outputPath, 'utf8');
  const candidateDir = githubOutput.match(/^candidate_dir=(.+)$/m)?.[1];
  assert.ok(candidateDir);
  assert.equal(await readFile(path.join(candidateDir, 'happier-cli.tar.gz'), 'utf8'), 'complete-candidate-bytes');
  assert.equal((await readFile(requestLog, 'utf8')).trim().split('\n').length, 2);
  assert.match(result.stderr, /retrying transient GitHub release read/i);
});
