import { describe, expect, it } from 'vitest';

import {
  deriveBoxPublicKeyFromSeed,
  openTerminalProvisioningV3Response,
} from '@happier-dev/protocol';
import { createSystemTasksRunner, type SetupMachineRecipeExecutor } from '@happier-dev/cli-common/systemTasks';

import { createSetupThisComputerInteractiveTaskKind } from './setupThisComputerInteractiveKind.js';

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

const RELAY_SERVER_URL = 'http://127.0.0.1:3005';
const RELAY_WEBAPP_URL = 'http://127.0.0.1:3005';

type PairingFixture = Readonly<{
  seed: Uint8Array;
  publicKeyB64: string;
  pairingSecret: Uint8Array;
  pairingSecretB64Url: string;
  createdAtMs: number;
  expiresAtMs: number;
}>;

function createPairingFixture(): PairingFixture {
  const seed = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) seed[index] = index + 1;
  const pairingSecret = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) pairingSecret[index] = index + 100;
  return {
    seed,
    publicKeyB64: Buffer.from(deriveBoxPublicKeyFromSeed(seed)).toString('base64'),
    pairingSecret,
    pairingSecretB64Url: Buffer.from(pairingSecret).toString('base64url'),
    createdAtMs: 1_000_000,
    expiresAtMs: 2_000_000,
  };
}

function createUnauthenticatedPairingExecutor(
  invocations: string[],
  fixture: PairingFixture,
): SetupMachineRecipeExecutor {
  return {
    configureRelay: async () => {
      invocations.push('configureRelay');
    },
    readAuthStatus: async () => {
      invocations.push('readAuthStatus');
      return { authenticated: false, machineId: null };
    },
    requestAuthPairing: async () => {
      invocations.push('requestAuthPairing');
      return {
        publicKey: fixture.publicKeyB64,
        pairing: {
          secretB64Url: fixture.pairingSecretB64Url,
          createdAtMs: fixture.createdAtMs,
          expiresAtMs: fixture.expiresAtMs,
        },
        supportsTokenOnly: true,
        claimSecret: 'claim-secret-value',
        pairingSecret: fixture.pairingSecretB64Url,
        stateFile: '/home/tester/.happier/auth/pending/abc123.json',
      } as unknown as Readonly<{ publicKey: string } & Record<string, unknown>>;
    },
    waitForAuthPairing: async (publicKey) => {
      invocations.push(`waitForAuthPairing:${publicKey}`);
      return { machineId: 'machine-1' };
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
  };
}

function noGuidanceDeps() {
  return {
    readBackgroundServiceSetupGuidance: async () => ({
      targetReleaseChannel: 'stable' as const,
      targetServerUrl: RELAY_SERVER_URL,
      currentHappierHomeDir: null,
      currentDefaultReleaseChannel: 'stable' as const,
      managedReleaseChannels: [],
      manualRelayOwner: null,
      conflictingServices: [],
      foreignHomeConflictingServices: [],
      exactDefaultServiceExists: false,
      shouldOfferDefaultReleaseChannelSwitch: false,
      shouldPromptForManualRelayTakeover: false,
      shouldPromptForServiceReplacement: false,
    }),
    readCurrentRelayOwner: async () => null,
    switchDefaultReleaseChannel: async () => undefined,
    uninstallExistingDaemonServices: async () => undefined,
  };
}

function eventJson(events: ReadonlyArray<unknown>): string {
  return JSON.stringify(events);
}

describe('setup.thisComputer.v1 pairing approval', () => {
  it('configures the explicit relay before reading auth status and pairing', async () => {
    const invocations: string[] = [];
    const fixture = createPairingFixture();
    const kind = createSetupThisComputerInteractiveTaskKind({
      ensureLocalHappierTools: async () => {
        invocations.push('ensureLocalHappierTools');
      },
      readActiveRelayProfile: async () => ({
        serverUrl: RELAY_SERVER_URL,
        webappUrl: RELAY_WEBAPP_URL,
        localServerUrl: null,
      }),
      createRecipeExecutor: () => createUnauthenticatedPairingExecutor(invocations, fixture),
      ...noGuidanceDeps(),
    });

    const runner = createSystemTasksRunner({ kinds: { 'setup.thisComputer.v1': kind } });
    await runner.start({
      taskId: 'setup-ordering',
      kind: 'setup.thisComputer.v1',
      params: { surface: 'desktop.ui', target: 'thisComputer' },
    });

    // The automatic approval prompt is part of the flow; answer it so the task completes.
    const promptPoll = await waitForPendingPrompt(runner, { taskId: 'setup-ordering', cursor: 0 });
    await runner.respond({ taskId: 'setup-ordering', answer: { approved: true } });

    const finalPoll = await waitForResult(runner, { taskId: 'setup-ordering', cursor: promptPoll.nextCursor });
    expect(finalPoll.result?.ok).toBe(true);

    const configureRelayIndex = invocations.indexOf('configureRelay');
    const readAuthStatusIndex = invocations.indexOf('readAuthStatus');
    const requestAuthPairingIndex = invocations.indexOf('requestAuthPairing');
    expect(configureRelayIndex).toBeGreaterThan(-1);
    expect(readAuthStatusIndex).toBeGreaterThan(configureRelayIndex);
    expect(requestAuthPairingIndex).toBeGreaterThan(readAuthStatusIndex);
  });

  it('issues one blocking token-only approval prompt that exposes only the opaque response and target identity', async () => {
    const invocations: string[] = [];
    const fixture = createPairingFixture();
    const kind = createSetupThisComputerInteractiveTaskKind({
      ensureLocalHappierTools: async () => {
        invocations.push('ensureLocalHappierTools');
      },
      readActiveRelayProfile: async () => ({
        serverUrl: RELAY_SERVER_URL,
        webappUrl: RELAY_WEBAPP_URL,
        localServerUrl: null,
      }),
      createRecipeExecutor: () => createUnauthenticatedPairingExecutor(invocations, fixture),
      ...noGuidanceDeps(),
    });

    const runner = createSystemTasksRunner({ kinds: { 'setup.thisComputer.v1': kind } });
    await runner.start({
      taskId: 'setup-approval',
      kind: 'setup.thisComputer.v1',
      params: { surface: 'desktop.ui', target: 'thisComputer' },
    });

    const promptPoll = await waitForPendingPrompt(runner, { taskId: 'setup-approval', cursor: 0 });
    const promptData = promptPoll.pendingPrompt?.data as Record<string, unknown>;
    expect(promptData).toBeTruthy();
    // Only the opaque response, its kind, the public key, and the explicit target identity.
    expect(Object.keys(promptData).sort()).toEqual([
      'kind',
      'publicKey',
      'relayUrl',
      'response',
      'responseKind',
      'webappUrl',
    ]);
    expect(promptData.kind).toBe('authRequest');
    expect(promptData.publicKey).toBe(fixture.publicKeyB64);
    expect(promptData.responseKind).toBe('tokenOnly');
    expect(promptData.relayUrl).toBe(RELAY_SERVER_URL);
    expect(promptData.webappUrl).toBe(RELAY_WEBAPP_URL);

    // The opaque response is the existing v3 token-only envelope, sealed with the retained
    // pairing context; opening it proves the protocol and that no credential is carried.
    const opened = openTerminalProvisioningV3Response({
      payload: new Uint8Array(Buffer.from(String(promptData.response), 'base64')),
      recipientSecretKeyOrSeed: fixture.seed,
      terminalEphemeralPublicKey: new Uint8Array(Buffer.from(fixture.publicKeyB64, 'base64')),
      pairingSecret: fixture.pairingSecret,
      createdAtMs: fixture.createdAtMs,
      expiresAtMs: fixture.expiresAtMs,
      nowMs: (fixture.createdAtMs + fixture.expiresAtMs) / 2,
    });
    expect(opened).toEqual({ type: 'tokenOnly' });

    // No pairing secret, claim secret, state file path, or bearer ever reaches task artifacts.
    const serializedEvents = eventJson(promptPoll.events);
    expect(serializedEvents).not.toContain(fixture.pairingSecretB64Url);
    expect(serializedEvents).not.toContain('claim-secret-value');
    expect(serializedEvents).not.toContain('/auth/pending');
    expect(serializedEvents.toLowerCase()).not.toMatch(/"(secret|pairingsecret|claimsecret|statefile|token)"/);

    await runner.respond({ taskId: 'setup-approval', answer: { approved: true } });
    const finalPoll = await waitForResult(runner, { taskId: 'setup-approval', cursor: promptPoll.nextCursor });
    expect(finalPoll.result).toMatchObject({ ok: true, data: { machineId: 'machine-1' } });
    expect(invocations).toContain(`waitForAuthPairing:${fixture.publicKeyB64}`);
  });

  it('falls back to the legacy manual approval surface when the approval answer is declined', async () => {
    const invocations: string[] = [];
    const fixture = createPairingFixture();
    const kind = createSetupThisComputerInteractiveTaskKind({
      ensureLocalHappierTools: async () => {
        invocations.push('ensureLocalHappierTools');
      },
      readActiveRelayProfile: async () => ({
        serverUrl: RELAY_SERVER_URL,
        webappUrl: RELAY_WEBAPP_URL,
        localServerUrl: null,
      }),
      createRecipeExecutor: () => createUnauthenticatedPairingExecutor(invocations, fixture),
      ...noGuidanceDeps(),
    });

    const runner = createSystemTasksRunner({ kinds: { 'setup.thisComputer.v1': kind } });
    await runner.start({
      taskId: 'setup-declined',
      kind: 'setup.thisComputer.v1',
      params: { surface: 'desktop.ui', target: 'thisComputer' },
    });

    const promptPoll = await waitForPendingPrompt(runner, { taskId: 'setup-declined', cursor: 0 });
    await runner.respond({ taskId: 'setup-declined', answer: { approved: false } });

    const finalPoll = await waitForResult(runner, { taskId: 'setup-declined', cursor: promptPoll.nextCursor });
    expect(finalPoll.result).toMatchObject({ ok: true, data: { machineId: 'machine-1' } });

    // The legacy manual surface remains available: a non-blocking authRequest prompt without
    // response material, and the task never hangs waiting for another answer.
    const legacyPrompt = finalPoll.events.find((event) => (
      (event as { type?: string }).type === 'prompt'
      && (event as { data?: Record<string, unknown> }).data != null
      && (event as { data?: Record<string, unknown> }).data!.response === undefined
    ));
    expect(legacyPrompt).toBeTruthy();
    const legacyData = (legacyPrompt as { data: Record<string, unknown> }).data;
    expect(Object.keys(legacyData).sort()).toEqual(['kind', 'publicKey', 'relayUrl', 'webappUrl']);
  });
});
