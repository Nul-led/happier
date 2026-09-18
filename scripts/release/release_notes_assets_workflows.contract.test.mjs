import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function loadWorkflow(name) {
  return readFile(join(repoRoot, '.github', 'workflows', name), 'utf8');
}

test('the release-owned UI promotion is the only writer of rolling release-note assets', async () => {
  const owner = await loadWorkflow('promote-ui.yml');
  assert.match(owner, /Build release notes assets/);
  assert.match(owner, /Publish release notes assets with trusted control/);
  assert.match(owner, /scripts\/pipeline\/release\/release-notes\/publish-release-notes-assets\.mjs/);
  assert.match(owner, /GH_REPO:\s*happier-dev\/happier-assets/);

  for (const workflow of ['build-ui-mobile-local.yml', 'publish-ui-web.yml', 'publish-ui-mobile-dev.yml']) {
    const raw = await loadWorkflow(workflow);
    assert.match(raw, /(?:sources\/scripts\/parseReleaseNotes\.ts|project-release-notes\.mjs)/);
    assert.doesNotMatch(raw, /publish-release-notes-assets\.mjs/);
    assert.doesNotMatch(raw, /release_notes_assets_token/);
  }
});

test('combined preview and production UI artifacts are isolated by channel', async () => {
  const workflow = parse(await loadWorkflow('promote-ui.yml'));
  const validateSteps = workflow.jobs.validate_candidate.steps;
  const promoteSteps = workflow.jobs.promote.steps;
  const releaseNotes = 'ui-release-notes-${{ inputs.environment }}-${{ needs.apply_bump.outputs.release_sha }}';
  const ota = 'ui-ota-${{ inputs.environment }}-${{ needs.apply_bump.outputs.release_sha }}';
  assert.equal(validateSteps.find((step) => step?.name === 'Upload release notes assets')?.with?.name, releaseNotes);
  assert.equal(validateSteps.find((step) => step?.name === 'Upload prepared OTA artifacts')?.with?.name, ota);
  assert.equal(promoteSteps.find((step) => step?.name === 'Download release notes assets')?.with?.name, releaseNotes);
  assert.equal(promoteSteps.find((step) => step?.name === 'Download prepared OTA artifacts')?.with?.name, ota);
});
