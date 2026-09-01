import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { classifyTestFile, EMPTY_TEST_LANE_CONTEXT } from './testLaneMap.ts';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/**
 * The inventory must not own run status: the sole Lane 09 release report owns
 * verified|failed|blocked|not-run. Status vocabulary anywhere in the module is a regression.
 */
test('Lane 09 inventory source owns no run status, evidence, or diagnosis vocabulary', async () => {
  const inventory = await import('./homesScenarioInventory.ts');
  const serialized = JSON.stringify(inventory);
  for (const status of ['verified', 'failed', 'blocked', 'not-run']) {
    assert.ok(!serialized.includes(`"${status}"`), `inventory still owns run status "${status}"`);
  }
});

test('the inventory is a small obligations-only requirement map with no mutable evidence', async () => {
  const inventory = await import('./homesScenarioInventory.ts');
  const map = inventory.HOMES_SCENARIO_FAMILY_MAP;
  assert.ok(Array.isArray(map), 'inventory must export the family requirement map');
  assert.ok(map.length > 0 && map.length <= 8, 'map should stay family-sized');

  const ids = map.flatMap((family: { requirementIds: readonly string[] }) => family.requirementIds);
  assert.equal(new Set(ids).size, ids.length, 'a requirement id is mapped by two families');
  const lanePlan = readFileSync(join(
    REPO_ROOT,
    '.project/plans/new-architecture/implementation/lane-09-integration-validation.md',
  ), 'utf8');
  const plannedIds = [...lanePlan.matchAll(/`(F-[A-Z]+-\d+ [^`\n]+)`/gu)].map((match) => match[1]);
  assert.deepEqual(
    [...ids].sort(),
    [...new Set(plannedIds)].sort(),
    'routing inventory must match the current plan obligations without owning their status',
  );
  for (const family of map) {
    assert.ok(family.productOwner.length > 0, `${family.familyId}: product owner is required`);
    for (const executableTestPath of family.executableTestPaths) {
      assert.match(executableTestPath, /\.(?:test|spec)\.[cm]?[jt]sx?$/, 'only ordinary runner files may be mapped');
    }
  }
});

test('every mapped executable test path exists and the canonical lane map collects it', async () => {
  const { HOMES_SCENARIO_FAMILY_MAP } = await import('./homesScenarioInventory.ts');
  for (const family of HOMES_SCENARIO_FAMILY_MAP) {
    assert.equal('lane' in family, false, `${family.familyId}: inventory must not own a family lane`);
    for (const executableTestPath of family.executableTestPaths) {
      assert.ok(existsSync(join(REPO_ROOT, executableTestPath)), `mapped test does not exist: ${executableTestPath}`);
      assert.ok(
        classifyTestFile(EMPTY_TEST_LANE_CONTEXT, executableTestPath),
        `${executableTestPath}: canonical lane map does not collect this representative`,
      );
    }
  }
});

test('the routing map includes representative composed, native, and production-root test paths', async () => {
  const { HOMES_SCENARIO_FAMILY_MAP } = await import('./homesScenarioInventory.ts');
  const paths = new Set(HOMES_SCENARIO_FAMILY_MAP.flatMap((family) => family.executableTestPaths));
  for (const path of [
    'packages/tests/suites/core-e2e/accountDirectory.homeEnrollment.composedCaller.slow.e2e.test.ts',
    'packages/tests/suites/core-e2e/accountDirectory.enrollmentOutage.slow.e2e.test.ts',
    'apps/server/sources/app/iroh/homeIrohEndpoint.real.integration.test.ts',
    'apps/server/sources/app/search/homeSearchLifecycle.spec.ts',
    'apps/cli/src/daemon/startup/createDaemonWorkspaceSyncRuntime.real.integration.test.ts',
    'apps/cli/src/daemon/startup/createProductionDaemonWorkspaceSyncRuntime.test.ts',
    'apps/cli/src/daemon/peer/iroh/workspaceMachineCarrierLane08.real.integration.test.ts',
  ]) {
    assert.ok(paths.has(path), `missing representative route: ${path}`);
  }

  const actualLanes = new Set([...paths].map((path) => classifyTestFile(EMPTY_TEST_LANE_CONTEXT, path)));
  assert.ok(actualLanes.has('test'), 'representatives must include an owner-level unit lane');
  assert.ok(actualLanes.has('test:home-iroh:real'), 'representatives must include the dedicated native transport lane');
  assert.ok(actualLanes.has('cli:test:workspace-sync:real'), 'representatives must include the real workspace-sync lane');
  assert.ok(actualLanes.has('test:e2e:core:slow'), 'representatives must include a composed slow lane');
});
