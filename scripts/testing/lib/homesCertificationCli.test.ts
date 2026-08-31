import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(testDirectory, '../../..');
const validator = resolve(repository, 'scripts/testing/validateHomesCertificationReport.ts');

test('requires an explicit Lane 09 evidence report path', () => {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', validator],
    { cwd: repository, encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:.*validateHomesCertificationReport\.ts <report-path>/u);
});

test('exposes a report completeness check rather than a scenario certification command', () => {
  const packageJson = JSON.parse(readFileSync(resolve(repository, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.['test:homes:certification'], undefined);
  assert.equal(packageJson.scripts?.['check:homes:evidence-report'], undefined);
  assert.equal(
    packageJson.scripts?.['check:homes:report-structure'],
    'node --experimental-strip-types ./scripts/testing/validateHomesCertificationReport.ts',
  );
});
