import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import YAML from 'yaml';

const repoRoot = new URL('../..', import.meta.url).pathname;
const workflow = YAML.parse(readFileSync(join(repoRoot, '.github/workflows/tests-dispatch.yml'), 'utf8'));
const resolver = workflow.jobs.resolve.steps.find((step) => step.id === 'flags');

function runResolver(profile, custom = '', uiE2eSpecs = '') {
  const scratch = mkdtempSync(join(tmpdir(), 'happier-ci-profile-'));
  const output = join(scratch, 'output');
  writeFileSync(output, '');
  try {
    const result = spawnSync('bash', ['-c', resolver.run], {
      cwd: repoRoot, encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: output, PROFILE: profile, CUSTOM: custom, UI_E2E_SPECS: uiE2eSpecs },
    });
    return { result, flags: Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split('=', 2))) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

test('hosted full preserves evolved workspace and home transport coverage without host mutations', () => {
  const { result, flags } = runResolver('full');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(flags).filter((key) => flags[key] === 'true').sort(), [
    'run_ui_e2e', 'run_workspace_sync_real', 'run_ui', 'run_plugin_workspaces', 'run_server',
    'run_home_iroh_real', 'run_cli', 'run_stack', 'run_typecheck', 'run_cli_daemon_e2e',
    'run_e2e_core', 'run_e2e_core_slow', 'run_server_db_contract', 'run_release_contracts',
    'run_installers_smoke', 'run_binary_smoke',
  ].sort());
  assert.equal(workflow.on.workflow_dispatch.inputs.custom_checks.required, false);
});

test('custom hosted checks trim and validate every token, rather than silently skipping requests', () => {
  const valid = runResolver('custom', ' plugin_workspaces , home_iroh_real ');
  assert.equal(valid.result.status, 0, valid.result.stderr);
  assert.equal(valid.flags.run_plugin_workspaces, 'true');
  assert.equal(valid.flags.run_home_iroh_real, 'true');
  assert.equal(valid.flags.run_ui, 'false');
  const invalid = runResolver('custom', 'plugin_workspaces,,unknown_one,unknown_two,');
  assert.equal(invalid.result.status, 1);
  assert.match(invalid.result.stderr, /empty custom_checks token/);
  assert.match(invalid.result.stderr, /unknown custom_checks: unknown_one, unknown_two/);
});

test('targeted UI specs require the custom UI lane and remain single-line output data', () => {
  assert.equal(runResolver('full', '', 'test.spec.ts').result.status, 1);
  assert.equal(runResolver('custom', 'cli', 'test.spec.ts').result.status, 1);
  assert.equal(runResolver('custom', 'ui_e2e', 'a\nb').result.status, 1);
  const valid = runResolver('custom', 'ui_e2e', 'test.spec.ts');
  assert.equal(valid.result.status, 0, valid.result.stderr);
  assert.equal(valid.flags.ui_e2e_specs, 'test.spec.ts');
});

test('custom CLI update continuity forwards target inputs while selecting no unrelated lane', () => {
  const { result, flags } = runResolver('custom', 'cli_update_continuity');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(flags).filter((key) => flags[key] === 'true'), ['run_cli_update_continuity']);
  assert.equal(workflow.jobs.tests.with.cli_update_to_source, '${{ inputs.cli_update_to_source }}');
  assert.equal(workflow.jobs.tests.with.cli_update_to_ref, '${{ inputs.cli_update_to_ref }}');
  assert.equal(workflow.jobs.tests.with.installers_channel, '${{ inputs.installers_channel }}');
});

test('custom release continuity lanes publish and forward their explicit selection', () => {
  const keys = ['cli_update_continuity', 'daemon_continuity', 'session_continuity', 'release_assets_docker'];
  const { result, flags } = runResolver('custom', keys.join(','));
  assert.equal(result.status, 0, result.stderr);
  for (const key of keys) {
    const output = 'run_' + key;
    assert.equal(flags[output], 'true');
    assert.equal(workflow.jobs.resolve.outputs[output], '${{ steps.flags.outputs.' + output + ' }}');
    assert.equal(workflow.jobs.tests.with[output], "${{ needs.resolve.outputs." + output + " == 'true' }}");
  }
});
