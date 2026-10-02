import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

async function workflow(name = 'release-source-validation.yml') {
  return parse(await readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'));
}

test('source gates bind all execution to one payload SHA and use trusted classification control', async () => {
  const source = await workflow();
  const steps = source.jobs.source_plan.steps;
  const control = steps.find((step) => step.name === 'Checkout trusted source-validation control');
  const payload = steps.find((step) => step.name === 'Checkout exact authorized release source');
  assert.equal(control.with.ref, '${{ job.workflow_sha }}');
  assert.equal(payload.with.ref, '${{ inputs.source_sha }}');
  assert.equal(payload.with.path, 'release-source');
  const classify = steps.find((step) => step.id === 'source');
  assert.equal(classify['working-directory'], 'release-source');
  assert.match(classify.run, /test "\$checkout_sha" = "\$SOURCE_SHA"/u);
  assert.match(classify.run, /node \.\.\/scripts\/pipeline\/release\/compute-changed-components\.mjs/u);
  assert.match(classify.run, /--bases "\$joined_base_shas"/u);
  for (const name of ['mysql', 'platform']) {
    assert.equal(source.jobs[name].with.checkout_sha, '${{ needs.source_plan.outputs.source_sha }}');
  }
  const trustCheckout = source.jobs.trust_roots.steps.find((step) => step.name === 'Checkout exact authorized release source');
  assert.equal(trustCheckout.with.ref, '${{ needs.source_plan.outputs.source_sha }}');
  const selection = steps.find((step) => step.id === 'selection');
  assert.equal(selection.env.CHANGED_RUNNER, '${{ steps.source.outputs.changed_runner }}');
  assert.equal(selection.env.RESUME_RUNNER_REQUESTED, '${{ inputs.resume_runner_requested }}');
});

test('dry runs and CI waivers never suppress required trust-root validation', async () => {
  const source = await workflow();
  assert.doesNotMatch(source.jobs.trust_roots.if, /inputs\.(?:dry_run|waive_ci)/u);
  assert.match(source.jobs.trust_roots.if, /needs\.source_plan\.result == 'success'/u);
  assert.match(source.jobs.trust_roots.if, /needs\.source_plan\.outputs\.run_trust_roots == 'true'/u);
});

test('shared exact-source CI preserves explicit completed run attestation', async () => {
  const source = await workflow();
  assert.equal(source.on.workflow_call.inputs.ci_run_id?.default, '');
  const ci = source.jobs.ci.steps.find((step) => step.name === 'Verify successful existing CI for exact source');
  assert.equal(ci.env.CI_RUN_ID, '${{ inputs.ci_run_id }}');
  assert.match(ci.run, /if \[ -n "\$CI_RUN_ID" \]; then/u);
  assert.match(ci.run, /args\+=\(--run-id "\$CI_RUN_ID"\)/u);
  assert.match(ci.run, /verify-existing-ci\.mjs "\$\{args\[@\]\}"/u);
});

test('source result projection permits source-only skips but rejects missing trust-root evidence', async () => {
  const source = await workflow();
  const project = source.jobs.results.steps.find((step) => step.id === 'evidence');
  const dir = await mkdtemp(join(tmpdir(), 'happier-source-validation-'));
  const env = {
    ...process.env,
    SOURCE_PLAN_RESULT: 'success', SOURCE_SHA: 'a'.repeat(40),
    RUN_MYSQL: 'true', RUN_PLATFORM: 'true', RUN_TRUST_ROOTS: 'true',
    CI_RESULT: 'skipped', MYSQL_RESULT: 'skipped', PLATFORM_RESULT: 'skipped',
  };
  for (const [dryRun, waiveCi] of [['true', 'false'], ['false', 'true']]) {
    const result = spawnSync('bash', ['-c', project.run], {
      encoding: 'utf8', env: { ...env, DRY_RUN: dryRun, WAIVE_CI: waiveCi, TRUST_ROOTS_RESULT: 'success', GITHUB_OUTPUT: join(dir, `${dryRun}-${waiveCi}`) },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = await readFile(join(dir, `${dryRun}-${waiveCi}`), 'utf8');
    assert.match(output, /trust_roots_result=success/u);
    const skippedTrust = spawnSync('bash', ['-c', project.run], {
      encoding: 'utf8', env: { ...env, DRY_RUN: dryRun, WAIVE_CI: waiveCi, TRUST_ROOTS_RESULT: 'skipped', GITHUB_OUTPUT: join(dir, 'rejected') },
    });
    assert.notEqual(skippedTrust.status, 0, 'required trust-root evidence cannot be waived');
  }
  const failedMysql = spawnSync('bash', ['-c', project.run], {
    encoding: 'utf8', env: { ...env, DRY_RUN: 'false', WAIVE_CI: 'false', CI_RESULT: 'success', MYSQL_RESULT: 'failure', PLATFORM_RESULT: 'success', TRUST_ROOTS_RESULT: 'success', GITHUB_OUTPUT: join(dir, 'failed-mysql') },
  });
  assert.notEqual(failedMysql.status, 0, 'unwaived source validation must reject a failed selected gate');
});

test('extended database gates honor the payload SHA for every provider checkout', async () => {
  const source = await workflow('extended-db-tests.yml');
  assert.equal(source.on.workflow_call.inputs.checkout_sha.default, '');
  for (const job of Object.values(source.jobs)) {
    const checkout = job.steps.find((step) => step.name === 'Checkout');
    assert.equal(checkout.with.ref, '${{ inputs.checkout_sha || github.sha }}');
  }
});

test('shared source gates forward only supported reusable inputs and select only platform service lanes', async () => {
  const source = await workflow();
  for (const name of ['mysql', 'platform']) {
    const job = source.jobs[name];
    const called = await workflow(job.uses.split('/').at(-1));
    for (const key of Object.keys(job.with)) {
      assert.ok(called.on.workflow_call.inputs[key], `${name} forwards unsupported input ${key}`);
    }
  }
  assert.equal(source.jobs.platform.with.select_jobs_explicitly, true);
  for (const [key, input] of Object.entries((await workflow('tests.yml')).on.workflow_call.inputs)) {
    if (!key.startsWith('run_')) continue;
    const selected = source.jobs.platform.with[key] ?? input.default;
    assert.equal(selected, key.startsWith('run_self_host_'), `${key} must not add an unrelated source-validation lane`);
  }
});
