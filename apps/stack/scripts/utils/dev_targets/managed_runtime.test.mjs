import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyManagedDevTargetCapacity,
  startDevTargetRuntime,
  startManagedDevTargetRuntime,
} from './managed_runtime.mjs';

test('managed runtime startup refreshes guest SSH publication from the running Lima instance before returning', async () => {
  const target = {
    name: 'worker',
    managedRuntime: {
      kind: 'lima',
      instance: 'happier-worker',
      limaHome: '/Users/dev/.happier/lima',
      host: { kind: 'local' },
    },
  };
  const calls = [];

  const result = await startManagedDevTargetRuntime({ target, env: {} }, {
    createExecutor: () => ({ marker: 'executor' }),
    startRuntime: async (input) => {
      calls.push(['start', input]);
      return { changed: true, status: 'Running' };
    },
    getRuntimeStatus: async (input) => {
      calls.push(['status', input]);
      return { exists: true, status: 'Running', instance: { sshLocalPort: 60955 } };
    },
    ensureGuestLoginManager: async (input) => {
      calls.push(['login-manager', input]);
      return { repaired: false };
    },
    reconcileSshPublication: async (input) => {
      calls.push(['publication', input]);
      return { changed: true, port: 60955, hostKeyAliasAdded: false };
    },
  });

  assert.equal(calls[0][0], 'start');
  assert.equal(calls[1][0], 'status');
  assert.equal(calls[2][0], 'login-manager');
  assert.equal(calls[3][0], 'publication');
  assert.equal(calls[3][1].sshLocalPort, 60955);
  assert.equal(calls[3][1].guestVerified, true);
  assert.deepEqual(result.guestLoginManager, { repaired: false });
  assert.deepEqual(result.sshPublication, { changed: true, port: 60955, hostKeyAliasAdded: false });
});

test('legacy local Lima targets use the canonical retained runtime lifecycle', async () => {
  const target = {
    name: 'linux',
    limaInstance: 'happier-dev-bench',
    limaHome: '/tmp/lima',
  };
  const calls = [];

  const result = await startDevTargetRuntime({ target, env: { TEST: '1' } }, {
    createExecutor: (runtimeTarget, env) => {
      calls.push(['executor', runtimeTarget, env]);
      return { marker: 'executor' };
    },
    startRuntime: async (input) => {
      calls.push(['start', input]);
      return { changed: true, status: 'Running' };
    },
    getRuntimeStatus: async (input) => {
      calls.push(['status', input]);
      return { exists: true, status: 'Running', instance: { sshLocalPort: 60955 } };
    },
    ensureGuestLoginManager: async (input) => {
      calls.push(['login-manager', input]);
      return { repaired: false };
    },
  });

  assert.equal(calls[0][0], 'executor');
  assert.deepEqual(calls[0][1].managedRuntime, {
    kind: 'lima',
    instance: 'happier-dev-bench',
    limaHome: '/tmp/lima',
    host: { kind: 'local' },
  });
  assert.equal(calls[1][0], 'start');
  assert.equal(calls[2][0], 'status');
  assert.equal(calls[3][0], 'login-manager');
  assert.deepEqual(result.guestLoginManager, { repaired: false });
  assert.equal(result.sshPublication, null);
});

test('managed capacity requires force for drift and republishes SSH after applying it', async () => {
  const target = {
    name: 'worker',
    managedRuntime: {
      kind: 'lima',
      instance: 'happier-worker',
      limaHome: '/Users/dev/.happier/lima',
      host: { kind: 'ssh' },
      profile: 'worker-balanced',
      architecture: 'aarch64',
      capacity: {
        mode: 'dedicated',
        shared: { cpus: 8, memoryGiB: 24 },
        dedicated: { cpus: 12, memoryGiB: 32 },
      },
    },
  };
  const calls = [];
  const dependencies = {
    createExecutor: () => ({ marker: 'executor' }),
    doctorRuntime: async (input) => {
      calls.push(['doctor', input]);
      return {
        ok: false,
        exists: true,
        status: 'Running',
        drift: { creation: [], resources: ['cpus'], configuration: [] },
      };
    },
    setupRuntime: async (input) => {
      calls.push(['setup', input]);
      return { reconfigured: true, status: 'Running' };
    },
    getRuntimeStatus: async () => ({
      exists: true,
      status: 'Running',
      instance: { sshLocalPort: 61234 },
    }),
    ensureGuestLoginManager: async () => ({ repaired: false }),
    reconcileSshPublication: async (input) => {
      calls.push(['publication', input]);
      return { changed: true, port: input.sshLocalPort };
    },
  };

  await assert.rejects(
    () => applyManagedDevTargetCapacity({ target, force: false, env: {} }, dependencies),
    (error) => error?.code === 'MANAGED_LIMA_CAPACITY_FORCE_REQUIRED',
  );
  assert.equal(calls.some(([kind]) => kind === 'setup'), false);

  const result = await applyManagedDevTargetCapacity(
    { target, force: true, env: {} },
    dependencies,
  );
  const setup = calls.find(([kind]) => kind === 'setup')[1];
  assert.deepEqual(setup.resources, { cpus: 12, memoryGiB: 32 });
  assert.equal(calls.at(-1)[0], 'publication');
  assert.equal(calls.at(-1)[1].sshLocalPort, 61234);
  assert.equal(result.changed, true);
});

test('managed capacity with no resource drift does not require or restart the VM', async () => {
  const target = {
    name: 'worker',
    managedRuntime: {
      kind: 'lima', instance: 'worker', limaHome: '/tmp/lima', host: { kind: 'local' },
      profile: 'worker-balanced', architecture: 'aarch64',
      capacity: {
        mode: 'shared',
        shared: { cpus: 8, memoryGiB: 24 },
        dedicated: { cpus: 12, memoryGiB: 32 },
      },
    },
  };
  let setupCalled = false;
  const result = await applyManagedDevTargetCapacity({ target, force: false, env: {} }, {
    createExecutor: () => ({}),
    doctorRuntime: async () => ({
      ok: true,
      exists: true,
      status: 'Running',
      drift: { creation: [], resources: [], configuration: [] },
    }),
    setupRuntime: async () => { setupCalled = true; },
  });

  assert.equal(setupCalled, false);
  assert.deepEqual(result, { changed: false, status: 'Running' });
});
