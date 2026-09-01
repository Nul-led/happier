import { describe, expect, it } from 'vitest';

import { createSystemTasksRunner } from '../interactiveTaskKinds.js';
import { createSetupRepairThisComputerTaskKind } from './setupRepairThisComputerKind.js';

async function waitForPendingPrompt(
  runner: ReturnType<typeof createSystemTasksRunner>,
  params: Readonly<{ taskId: string; cursor: number }>,
) {
  let latest = await runner.poll(params);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    latest = await runner.poll(params);
    if (latest.pendingPrompt) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Expected pending prompt for ${params.taskId}: ${JSON.stringify(latest)}`);
}

async function waitForResult(
  runner: ReturnType<typeof createSystemTasksRunner>,
  params: Readonly<{ taskId: string; cursor: number }>,
) {
  let latest = await runner.poll(params);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    latest = await runner.poll(params);
    if (latest.result) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Expected final result for ${params.taskId}: ${JSON.stringify(latest)}`);
}

describe('createSetupRepairThisComputerTaskKind', () => {
  it('prompts for auth when unauthenticated and returns machineId after daemon is ready', async () => {
    const invocations: string[] = [];
    const kind = createSetupRepairThisComputerTaskKind({
      readActiveRelayProfile: async () => ({
        serverUrl: 'https://relay.ignored-by-test.example.test',
        webappUrl: 'https://app.ignored-by-test.example.test',
        activeLocalRelayUrl: null,
      }),
      readAuthStatus: async () => ({ authenticated: false }),
      configureRelay: async () => {
        invocations.push('configureRelay');
      },
      requestAuthPairing: async () => ({ publicKey: 'pub-key' }),
      waitForAuthPairing: async (publicKey: string) => {
        invocations.push(`waitForAuthPairing:${publicKey}`);
        return { machineId: 'machine-1' };
      },
      pairLocalMachineIfNeeded: async () => {
        throw new Error('pairLocalMachineIfNeeded should not be called when unauthenticated');
      },
      installDaemonService: async () => {
        invocations.push('installDaemonService');
      },
      startDaemonService: async () => {
        invocations.push('startDaemonService');
      },
      waitForReadyDaemon: async () => ({
        serviceInstalled: true,
        daemonRunning: true,
        needsAuth: false,
        machineId: 'machine-1',
      }),
    });

    const runner = createSystemTasksRunner({
      kinds: {
        'setup.repairThisComputer.v1': kind,
      },
    });

    await runner.start({
      taskId: 'repair-task',
      kind: 'setup.repairThisComputer.v1',
      params: {
        activeRelayUrl: 'https://relay.example.test',
        activeWebappUrl: 'https://app.example.test',
        activeLocalRelayUrl: null,
        surface: 'desktop.ui',
      },
    });

    const firstPoll = await waitForPendingPrompt(runner, { taskId: 'repair-task', cursor: 0 });
    expect(firstPoll.pendingPrompt).toEqual({
      kind: 'authRequest',
      data: {
        kind: 'authRequest',
        publicKey: 'pub-key',
        relayUrl: 'https://relay.example.test',
        webappUrl: 'https://app.example.test',
      },
    });

    await runner.respond({
      taskId: 'repair-task',
      answer: { approved: true },
    });

    const finalPoll = await waitForResult(runner, { taskId: 'repair-task', cursor: firstPoll.nextCursor });
    expect(finalPoll.result).toEqual({
      protocolVersion: 1,
      taskId: 'repair-task',
      ok: true,
      data: { machineId: 'machine-1' },
    });
    expect(invocations).toEqual([
      'configureRelay',
      'waitForAuthPairing:pub-key',
      'installDaemonService',
      'startDaemonService',
    ]);
  });

  it('fails with daemon_service_not_ready when the daemon never reaches a ready state', async () => {
    const kind = createSetupRepairThisComputerTaskKind({
      readActiveRelayProfile: async () => ({
        serverUrl: 'https://relay.example.test',
        webappUrl: 'https://app.example.test',
        activeLocalRelayUrl: null,
      }),
      readAuthStatus: async () => ({
        authenticated: true,
        credentialState: 'valid',
        machineRegistrationState: 'server-confirmed',
        machineId: 'machine-1',
      }),
      configureRelay: async () => undefined,
      requestAuthPairing: async () => ({ publicKey: 'pub-key' }),
      waitForAuthPairing: async () => ({ machineId: 'machine-1' }),
      pairLocalMachineIfNeeded: async () => 'machine-1',
      installDaemonService: async () => undefined,
      startDaemonService: async () => undefined,
      waitForReadyDaemon: async () => ({
        serviceInstalled: false,
        daemonRunning: false,
        needsAuth: true,
        machineId: null,
      }),
    });

    const runner = createSystemTasksRunner({
      kinds: {
        'setup.repairThisComputer.v1': kind,
      },
    });

    await runner.start({
      taskId: 'repair-task',
      kind: 'setup.repairThisComputer.v1',
      params: {
        activeRelayUrl: 'https://relay.example.test',
        activeWebappUrl: 'https://app.example.test',
        activeLocalRelayUrl: null,
        surface: 'desktop.ui',
      },
    });

    const finalPoll = await waitForResult(runner, { taskId: 'repair-task', cursor: 0 });
    expect(finalPoll.result).toEqual({
      protocolVersion: 1,
      taskId: 'repair-task',
      ok: false,
      error: {
        code: 'daemon_service_not_ready',
        message: 'Background service did not reach a ready state for the selected Relay.',
      },
    });
  });

  it('still requests pairing when the machine is authenticated but no machine id can be recovered yet', async () => {
    const invocations: string[] = [];
    const kind = createSetupRepairThisComputerTaskKind({
      readActiveRelayProfile: async () => ({
        serverUrl: 'https://relay.example.test',
        webappUrl: 'https://app.example.test',
        activeLocalRelayUrl: null,
      }),
      readAuthStatus: async () => ({ authenticated: true, machineId: null }),
      configureRelay: async () => {
        invocations.push('configureRelay');
      },
      requestAuthPairing: async () => ({ publicKey: 'pub-key-missing-machine' }),
      waitForAuthPairing: async (publicKey: string) => {
        invocations.push(`waitForAuthPairing:${publicKey}`);
        return { machineId: 'machine-2' };
      },
      pairLocalMachineIfNeeded: async () => '',
      installDaemonService: async () => {
        invocations.push('installDaemonService');
      },
      startDaemonService: async () => {
        invocations.push('startDaemonService');
      },
      waitForReadyDaemon: async () => ({
        serviceInstalled: true,
        daemonRunning: true,
        needsAuth: false,
        machineId: 'machine-2',
      }),
    });

    const runner = createSystemTasksRunner({
      kinds: {
        'setup.repairThisComputer.v1': kind,
      },
    });

    await runner.start({
      taskId: 'repair-task',
      kind: 'setup.repairThisComputer.v1',
      params: {
        activeRelayUrl: 'https://relay.example.test',
        activeWebappUrl: 'https://app.example.test',
        activeLocalRelayUrl: null,
        surface: 'desktop.ui',
      },
    });

    const firstPoll = await waitForPendingPrompt(runner, { taskId: 'repair-task', cursor: 0 });
    expect(firstPoll.pendingPrompt).toEqual({
      kind: 'authRequest',
      data: {
        kind: 'authRequest',
        publicKey: 'pub-key-missing-machine',
        relayUrl: 'https://relay.example.test',
        webappUrl: 'https://app.example.test',
      },
    });

    await runner.respond({
      taskId: 'repair-task',
      answer: { approved: true },
    });

    const finalPoll = await waitForResult(runner, { taskId: 'repair-task', cursor: firstPoll.nextCursor });
    expect(finalPoll.result).toEqual({
      protocolVersion: 1,
      taskId: 'repair-task',
      ok: true,
      data: { machineId: 'machine-2' },
    });
    expect(invocations).toEqual([
      'configureRelay',
      'waitForAuthPairing:pub-key-missing-machine',
      'installDaemonService',
      'startDaemonService',
    ]);
  });

  it('does not let legacy true booleans override an explicit unknown credential state', async () => {
    let pairLocalCalls = 0;
    const kind = createSetupRepairThisComputerTaskKind({
      readActiveRelayProfile: async () => ({
        serverUrl: 'https://relay.example.test',
        webappUrl: 'https://app.example.test',
        activeLocalRelayUrl: null,
      }),
      readAuthStatus: async () => ({
        authenticated: true,
        credentialState: 'unknown',
        machineRegistered: true,
        machineRegistrationState: 'server-confirmed',
        machineId: 'machine-local',
      }),
      configureRelay: async () => undefined,
      requestAuthPairing: async () => ({ publicKey: 'pub-key-unknown' }),
      waitForAuthPairing: async () => ({ machineId: 'machine-new' }),
      pairLocalMachineIfNeeded: async () => {
        pairLocalCalls += 1;
        return 'machine-local';
      },
      installDaemonService: async () => undefined,
      startDaemonService: async () => undefined,
      waitForReadyDaemon: async () => ({
        serviceInstalled: true,
        daemonRunning: true,
        needsAuth: false,
        credentialState: 'valid',
        machineRegistrationState: 'server-confirmed',
        machineId: 'machine-new',
      }),
    });
    const runner = createSystemTasksRunner({
      kinds: { 'setup.repairThisComputer.v1': kind },
    });

    await runner.start({
      taskId: 'repair-unknown',
      kind: 'setup.repairThisComputer.v1',
      params: { activeRelayUrl: 'https://relay.example.test' },
    });

    const firstPoll = await waitForPendingPrompt(runner, { taskId: 'repair-unknown', cursor: 0 });
    expect(firstPoll.pendingPrompt?.data).toMatchObject({ publicKey: 'pub-key-unknown' });
    expect(pairLocalCalls).toBe(0);
    await runner.respond({ taskId: 'repair-unknown', answer: { approved: true } });
    const finalPoll = await waitForResult(runner, {
      taskId: 'repair-unknown',
      cursor: firstPoll.nextCursor,
    });
    expect(finalPoll.result?.ok).toBe(true);
  });

  it('requires pairing when only legacy booleans and a local machine id claim readiness', async () => {
    let pairLocalCalls = 0;
    const kind = createSetupRepairThisComputerTaskKind({
      readActiveRelayProfile: async () => ({
        serverUrl: 'https://relay.example.test',
        webappUrl: 'https://app.example.test',
        activeLocalRelayUrl: null,
      }),
      readAuthStatus: async () => ({
        authenticated: true,
        machineRegistered: true,
        machineId: 'machine-legacy',
      }),
      configureRelay: async () => undefined,
      requestAuthPairing: async () => ({ publicKey: 'pub-key-legacy' }),
      waitForAuthPairing: async () => ({ machineId: 'machine-current' }),
      pairLocalMachineIfNeeded: async () => {
        pairLocalCalls += 1;
        return 'machine-legacy';
      },
      installDaemonService: async () => undefined,
      startDaemonService: async () => undefined,
      waitForReadyDaemon: async () => ({
        serviceInstalled: true,
        daemonRunning: true,
        needsAuth: false,
        credentialState: 'valid',
        machineRegistrationState: 'server-confirmed',
        machineId: 'machine-current',
      }),
    });
    const runner = createSystemTasksRunner({
      kinds: { 'setup.repairThisComputer.v1': kind },
    });

    await runner.start({
      taskId: 'repair-legacy-readiness',
      kind: 'setup.repairThisComputer.v1',
      params: { activeRelayUrl: 'https://relay.example.test' },
    });

    const firstPoll = await waitForPendingPrompt(runner, {
      taskId: 'repair-legacy-readiness',
      cursor: 0,
    });
    expect(firstPoll.pendingPrompt?.data).toMatchObject({ publicKey: 'pub-key-legacy' });
    expect(pairLocalCalls).toBe(0);

    await runner.respond({ taskId: 'repair-legacy-readiness', answer: { approved: true } });
    const finalPoll = await waitForResult(runner, {
      taskId: 'repair-legacy-readiness',
      cursor: firstPoll.nextCursor,
    });
    expect(finalPoll.result).toEqual({
      protocolVersion: 1,
      taskId: 'repair-legacy-readiness',
      ok: true,
      data: { machineId: 'machine-current' },
    });
  });
});
