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

test('promote-docs records the deploy branch and publishes the validated artifact directly', async () => {
  const raw = await loadWorkflow('promote-docs.yml');
  assert.match(raw, /node scripts\/pipeline\/github\/promote-deploy-branch\.mjs/);
  assert.match(raw, /deploy_cloudflare:/);
  assert.match(raw, /Download the exact built site/);
  assert.doesNotMatch(raw, /node scripts\/pipeline\/deploy\/trigger-webhooks\.mjs/);
  assert.doesNotMatch(raw, /Wait for deploy workflow/i);
  const workflow = parse(raw);
  const upload = workflow.jobs.validate_candidate.steps.find((step) => step.name === 'Upload the exact built site');
  const download = workflow.jobs.deploy_cloudflare.steps.find((step) => step.name === 'Download the exact built site');
  assert.equal(upload.with.name, 'docs-out-${{ inputs.environment }}-${{ github.sha }}');
  assert.equal(download.with.name, upload.with.name);
});
