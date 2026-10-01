import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { AGENT_IDS } from '../packages/agents/src/generated/agentIds.ts';

const repoRoot = new URL('../', import.meta.url);

function readRenderedAgentIds(svg) {
  return [...svg.matchAll(/^  <!-- ([A-Za-z0-9_]+) -->$/gmu)].map((entry) => entry[1]);
}

test('generates both supported-agent strips in bundled catalog order', async () => {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/generateSupportedAgentsStrip.mjs'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const skippedLine = result.stdout.split('\n').find((line) => line.startsWith('Skipped: '));
  const skippedIds = new Set(
    skippedLine?.slice('Skipped: '.length).split(', ').map((entry) => entry.split(' ')[0]) ?? [],
  );
  const expectedRenderedIds = AGENT_IDS.filter((agentId) => !skippedIds.has(agentId));

  for (const variant of ['light', 'dark']) {
    const svg = await readFile(new URL(`.github/supported-agents-${variant}.svg`, repoRoot), 'utf8');
    assert.deepEqual(readRenderedAgentIds(svg), expectedRenderedIds);
  }

  assert.deepEqual(
    new Set([...expectedRenderedIds, ...skippedIds]),
    new Set(AGENT_IDS),
    'every bundled agent must be rendered or explicitly reported as skipped',
  );
});
