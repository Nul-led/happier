import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { RunnerActivationBindingV1Schema } from '@happier-dev/protocol/ephemeralRunner/activation';
import type { RunnerEndpointFactsV1 } from '@happier-dev/protocol/ephemeralRunner/endpoint';
import { runnerArtifactTargetForPlatform } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';
import tweetnacl from 'tweetnacl';
import { describe, expect, it, vi } from 'vitest';

import packageJson from '../../package.json';
import {
  createEphemeralRunnerController,
  type EphemeralRunnerDependencies,
  type EphemeralRunnerEndpointUi,
} from './controlPlane';
import { createEphemeralRunnerHttpControlConnection } from './controlClient';

function fixture() {
  const activation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(13));
  const installation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(19));
  const authoringCommitment = encodeBase64(new Uint8Array(32).fill(23), 'base64url');
  const artifactTarget = runnerArtifactTargetForPlatform({
    os: process.platform === 'win32' ? 'windows' : process.platform,
    arch: process.arch,
  });
  if (!artifactTarget) throw new Error('Test host is not a supported Runner target');
  const binding = RunnerActivationBindingV1Schema.parse({
    activationId: '00000000-0000-4000-8000-000000000013',
    homeServerIdentityId: 'srv_runner_home',
    creatorAccountId: 'creator',
    creatorTokenEpoch: 1,
    activationExpiresAt: null,
    workspace: { kind: 'choose_on_endpoint' },
    sessionId: 'session-13',
    machineId: 'machine-13',
    activationSigningPublicKey: encodeBase64(activation.publicKey, 'base64url'),
    authoringCommitment,
    artifact: { product: 'happier-runner', version: packageJson.version, target: artifactTarget, sha256: 'a'.repeat(64) },
    endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'creator' },
  });
  return {
    activationSecretKey: activation.secretKey,
    binding,
    installation: {
      version: 1 as const,
      installationId: 'installation-13',
      createdAt: 1,
      publicKey: encodeBase64(installation.publicKey, 'base64url'),
      privateKey: encodeBase64(installation.secretKey, 'base64url'),
    },
  };
}

function harness(input?: Readonly<{ allow?: boolean }>) {
  const events: string[] = [];
  const storedEndpointFacts: RunnerEndpointFactsV1[] = [];
  let connectionListener: ((state: 'connected' | 'reconnecting') => void) | null = null;
  let settleTerminal!: (value: { status: 'completed' } | { status: 'failed'; error: Error }) => void;
  const terminal = new Promise<{ status: 'completed' } | { status: 'failed'; error: Error }>((resolve) => {
    settleTerminal = resolve;
  });
  const manifest: Readonly<{
    agentId: 'codex';
    prompt: 'Fix the bug';
    endpointFacts: Readonly<{ directory: string }>;
  }> = Object.freeze({
      agentId: 'codex',
      prompt: 'Fix the bug',
      endpointFacts: Object.freeze({ directory: '/workspace/project' }),
  });
  const review: Readonly<{
    manifest: typeof manifest;
    launchManifestCommitment: string;
    authoringCommitment: string;
    directory: string;
  }> = Object.freeze({
    manifest,
    launchManifestCommitment: encodeBase64(new Uint8Array(32).fill(29), 'base64url'),
    authoringCommitment: fixture().binding.authoringCommitment,
    directory: '/workspace/project',
  });
  const deps: EphemeralRunnerDependencies<typeof review.manifest, { sessionId: string }, { command: string }> = {
    createConnection: vi.fn(async () => ({
      claim: vi.fn(async ({ claim }) => { events.push('claim'); return claim; }),
      reportProgress: vi.fn(async ({ phase }) => { events.push(`progress.${phase}`); }),
      storeEndpointFacts: vi.fn(async ({ endpointFacts }) => { storedEndpointFacts.push(endpointFacts); events.push('facts'); }),
      waitForReview: vi.fn(async () => { events.push('review'); return review; }),
      submitConsent: vi.fn(async () => { events.push('consent'); }),
      submitReadiness: vi.fn(async () => { events.push('readiness.publish'); }),
      decline: vi.fn(async () => { events.push('decline'); }),
      onConnectionState: (listener: (state: 'connected' | 'reconnecting') => void) => { connectionListener = listener; return () => { connectionListener = null; }; },
      close: vi.fn(async () => { events.push('connection.close'); }),
    })),
    prepareReviewedPluginAcquisition: vi.fn(async () => {
      events.push('plugin.prepare');
      return {
        review: null,
        apply: vi.fn(async () => { events.push('plugin.apply'); }),
        release: vi.fn(async () => { events.push('plugin.release'); }),
      };
    }),
    prepareAgent: vi.fn(async () => { events.push('prepare'); return { command: '/managed/codex' }; }),
    releasePreparation: vi.fn(async () => { events.push('preparation.release'); }),
    checkNonInferenceReadiness: vi.fn(async () => { events.push('readiness'); return { status: 'ready' as const, readiness: {} as never }; }),
    materialize: vi.fn(async () => { events.push('materialize'); return { sessionId: 'session-13' }; }),
    startSession: vi.fn(async () => {
      events.push('start');
      return {
        terminal,
        stop: vi.fn(async () => { events.push('runtime.stop'); settleTerminal({ status: 'completed' }); }),
      };
    }),
    releaseMaterialized: vi.fn(async () => { events.push('materialized.release'); }),
  };
  const phases: string[] = [];
  const snapshots: Array<Parameters<EphemeralRunnerEndpointUi<typeof review.manifest>['present']>[0]> = [];
  const ui: EphemeralRunnerEndpointUi<typeof review.manifest> = {
    selectDirectory: vi.fn(async () => '/workspace/project'),
    reviewAndRequestConsent: vi.fn(async () => input?.allow ?? true),
    confirmActiveClose: vi.fn(async () => 'stop' as const),
    requestFailureRecovery: vi.fn(async () => 'exit' as const),
    bindControls: vi.fn(() => () => undefined),
    present: (snapshot) => {
      snapshots.push(snapshot);
      phases.push(`${snapshot.phase}:${snapshot.connection}`);
    },
  };
  return { deps, ui, events, phases, snapshots, review, storedEndpointFacts, terminal, settleTerminal, emitConnection: (state: 'connected' | 'reconnecting') => connectionListener?.(state) };
}

describe('ephemeral Runner endpoint control plane', () => {
  it('cancels the exact activation when Stop races a claim whose response is lost', async () => {
    const f = fixture();
    const h = harness();
    vi.mocked(h.deps.createConnection).mockImplementation(async () => ({
      claim: vi.fn(async ({ signal }) => await new Promise<never>((_resolve, reject) => {
        h.events.push('claim');
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })),
      storeEndpointFacts: vi.fn(async () => undefined),
      reportProgress: vi.fn(async () => undefined),
      waitForReview: vi.fn(async () => h.review),
      submitConsent: vi.fn(async () => undefined),
      submitReadiness: vi.fn(async () => undefined),
      decline: vi.fn(async () => { h.events.push('decline'); }),
      onConnectionState: () => () => undefined,
      close: vi.fn(async () => { h.events.push('connection.close'); }),
    }));
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    const running = controller.run();
    await vi.waitFor(() => expect(h.events).toContain('claim'));
    await expect(controller.requestClose()).resolves.toBe('stopped');
    await expect(running).resolves.toEqual({ status: 'cancelled' });
    expect(h.events.filter((event) => event === 'decline')).toHaveLength(1);
  });

  it('requires visible affirmative consent, performs non-inference readiness before materialization, and reuses one runtime across reconnect', async () => {
    const f = fixture();
    const h = harness();
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: { HAPPIER_HOME_DIR: '/runner/home' }, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    const running = controller.run();
    await vi.waitFor(() => expect(h.events).toContain('start'));
    h.emitConnection('reconnecting');
    h.emitConnection('connected');
    expect(h.deps.startSession).toHaveBeenCalledOnce();
    expect(h.deps.createConnection).toHaveBeenCalledWith(expect.objectContaining({
      homeDirectory: '/runner/home',
    }));
    expect(h.storedEndpointFacts).toHaveLength(1);
    expect(h.storedEndpointFacts[0]?.payload.content).toEqual({
      t: 'plain',
      v: {
        v: 1,
        directory: '/workspace/project',
        machine: {
          host: expect.any(String),
          platform: process.platform,
          happyCliVersion: packageJson.version,
          happyHomeDir: '/runner/home',
          homeDir: '/endpoint/home',
        },
      },
    });
    expect(h.deps.startSession).toHaveBeenCalledWith(expect.objectContaining({
      manifest: expect.objectContaining({ endpointFacts: { directory: '/workspace/project' } }),
    }));
    h.settleTerminal({ status: 'completed' });

    await expect(running).resolves.toMatchObject({ status: 'completed' });
    expect(h.events).toEqual([
      'claim', 'facts', 'review', 'plugin.prepare', 'plugin.apply', 'consent', 'prepare',
      'progress.checking_ai_access', 'readiness', 'readiness.publish',
      'materialize', 'start',
      'runtime.stop', 'materialized.release', 'preparation.release', 'plugin.release', 'connection.close', 'state.dispose',
    ]);
    expect(h.phases).toContain('running:reconnecting');
    expect(h.phases.at(-1)).toBe('completed:connected');
  });

  it('declines without installation, readiness, materialization, or runtime side effects', async () => {
    const f = fixture();
    const h = harness({ allow: false });
    const dispose = vi.fn(async () => { h.events.push('state.dispose'); });
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    await expect(controller.run()).resolves.toEqual({ status: 'declined' });
    expect(h.events).toEqual(['claim', 'facts', 'review', 'plugin.prepare', 'decline', 'plugin.release', 'connection.close', 'state.dispose']);
    expect(h.deps.prepareAgent).not.toHaveBeenCalled();
    expect(h.deps.materialize).not.toHaveBeenCalled();
  });

  it('settles only an explicit folder-step cancellation while picker dismissal remains UI-owned', async () => {
    const f = fixture();
    const h = harness();
    vi.mocked(h.ui.selectDirectory)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('folder UI was called again after explicit cancellation'));
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    await expect(controller.run()).resolves.toEqual({ status: 'declined' });
    expect(h.ui.selectDirectory).toHaveBeenCalledOnce();
    expect(h.events).toEqual([
      'claim', 'decline', 'connection.close', 'state.dispose',
    ]);
    expect(h.storedEndpointFacts).toEqual([]);
    expect(h.deps.startSession).not.toHaveBeenCalled();
  });

  it('uses the canonical endpoint home without presenting the folder picker', async () => {
    const base = fixture();
    const f = { ...base, binding: RunnerActivationBindingV1Schema.parse({
      ...base.binding,
      workspace: { kind: 'endpoint_home' },
    }) };
    const h = harness();
    vi.mocked(h.deps.createConnection).mockImplementation(async () => ({
      claim: vi.fn(async ({ claim }) => claim),
      reportProgress: vi.fn(async () => undefined),
      storeEndpointFacts: vi.fn(async ({ endpointFacts }) => { h.storedEndpointFacts.push(endpointFacts); }),
      waitForReview: vi.fn(async () => ({
        ...h.review,
        manifest: {
          ...h.review.manifest,
          endpointFacts: { directory: '/endpoint/home' },
        },
        directory: '/endpoint/home',
      })),
      submitConsent: vi.fn(async () => undefined),
      submitReadiness: vi.fn(async () => undefined),
      decline: vi.fn(async () => undefined),
      onConnectionState: () => () => undefined,
      close: vi.fn(async () => undefined),
    }));
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => undefined) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    const running = controller.run();
    await vi.waitFor(() => expect(h.deps.startSession).toHaveBeenCalledOnce());
    h.settleTerminal({ status: 'completed' });
    await expect(running).resolves.toEqual({ status: 'completed' });
    expect(h.ui.selectDirectory).not.toHaveBeenCalled();
    expect(h.storedEndpointFacts[0]?.payload.content).toMatchObject({
      t: 'plain',
      v: { directory: '/endpoint/home' },
    });
    expect(h.deps.startSession).toHaveBeenCalledWith(expect.objectContaining({
      manifest: expect.objectContaining({ endpointFacts: { directory: '/endpoint/home' } }),
    }));
  });

  it('refuses a reviewed manifest that re-authored the request before asking for consent', async () => {
    const f = fixture();
    const h = harness();
    vi.mocked(h.deps.createConnection).mockImplementation(async () => ({
      claim: vi.fn(async ({ claim }) => { h.events.push('claim'); return claim; }),
      reportProgress: vi.fn(async () => undefined),
      storeEndpointFacts: vi.fn(async () => { h.events.push('facts'); }),
      waitForReview: vi.fn(async () => {
        h.events.push('review');
        return { ...h.review, authoringCommitment: encodeBase64(new Uint8Array(32).fill(31), 'base64url') };
      }),
      submitConsent: vi.fn(async () => { h.events.push('consent'); }),
      submitReadiness: vi.fn(async () => undefined),
      decline: vi.fn(async () => { h.events.push('decline'); }),
      onConnectionState: () => () => undefined,
      close: vi.fn(async () => { h.events.push('connection.close'); }),
    }));
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => undefined) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    await expect(controller.run()).resolves.toMatchObject({ status: 'failed' });
    expect(h.ui.reviewAndRequestConsent).not.toHaveBeenCalled();
    expect(h.events).not.toContain('consent');
    expect(h.deps.materialize).not.toHaveBeenCalled();
  });

  it('stops through the ordinary runtime before releasing local materialized custody', async () => {
    const f = fixture();
    const h = harness();
    let releaseMaterialized!: () => void;
    vi.mocked(h.deps.releaseMaterialized).mockImplementation(async () => new Promise<void>((resolve) => { releaseMaterialized = resolve; }));
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });
    const running = controller.run();
    await vi.waitFor(() => expect(h.events).toContain('start'));

    const stopping = controller.stop();
    await vi.waitFor(() => expect(h.events).toContain('runtime.stop'));
    expect(h.events).not.toContain('state.dispose');
    await vi.waitFor(() => expect(releaseMaterialized).toBeTypeOf('function'));
    releaseMaterialized();
    await stopping;
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(h.events).toContain('state.dispose');
  });

  it('keeps an active Session visible when close is declined, then confirms one canonical Stop', async () => {
    const f = fixture();
    const h = harness();
    vi.mocked(h.ui.confirmActiveClose)
      .mockResolvedValueOnce('keep_open')
      .mockResolvedValueOnce('stop');
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });
    const running = controller.run();
    await vi.waitFor(() => expect(h.events).toContain('start'));

    await expect(controller.requestClose()).resolves.toBe('kept_open');
    expect(h.events).not.toContain('runtime.stop');
    await expect(controller.requestClose()).resolves.toBe('stopped');
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(h.events.filter((event) => event === 'runtime.stop')).toHaveLength(1);
    expect(h.ui.confirmActiveClose).toHaveBeenCalledTimes(2);
  });

  it('stops a runtime that finishes starting after the endpoint user already chose Stop', async () => {
    const f = fixture();
    const h = harness();
    const runtimeStop = vi.fn(async () => { h.events.push('late-runtime.stop'); });
    let finishStart!: (runtime: Awaited<ReturnType<typeof h.deps.startSession>>) => void;
    vi.mocked(h.deps.startSession).mockImplementation(async () => {
      h.events.push('start');
      return await new Promise((resolve) => {
        finishStart = resolve;
      });
    });
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });
    const running = controller.run();
    await vi.waitFor(() => expect(h.snapshots.at(-1)?.phase).toBe('starting'));

    const closing = controller.requestClose();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(h.events).not.toContain('materialized.release');
    finishStart({
      terminal: Promise.resolve({ status: 'completed' }),
      stop: runtimeStop,
    });

    await expect(closing).resolves.toBe('stopped');
    await expect(running).resolves.toEqual({ status: 'cancelled' });
    expect(runtimeStop).toHaveBeenCalledOnce();
    expect(h.events.indexOf('late-runtime.stop')).toBeLessThan(h.events.indexOf('materialized.release'));
    expect(h.snapshots.some((snapshot) => snapshot.phase === 'running')).toBe(false);
  });

  it('routes a materialization response that arrives after Stop through the ordinary Session stop owner', async () => {
    const f = fixture();
    const h = harness();
    let finishMaterialization!: (materialized: { sessionId: string }) => void;
    vi.mocked(h.deps.materialize).mockImplementation(async () => {
      h.events.push('materialize');
      return await new Promise((resolve) => {
        finishMaterialization = resolve;
      });
    });
    const ordinarySessionStop = vi.fn(async () => {
      h.events.push('ordinary-session.stop');
      h.settleTerminal({ status: 'completed' });
    });
    vi.mocked(h.deps.startSession).mockImplementation(async (rawInput) => {
      h.events.push('start');
      rawInput.onRuntimeStopReady(ordinarySessionStop);
      return {
        terminal: h.terminal,
        stop: ordinarySessionStop,
      };
    });
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    const running = controller.run();
    await vi.waitFor(() => expect(h.events).toContain('materialize'));
    await controller.stop();
    finishMaterialization({ sessionId: 'session-13' });

    await expect(running).resolves.toEqual({ status: 'cancelled' });
    expect(ordinarySessionStop).toHaveBeenCalledOnce();
    expect(h.events.indexOf('ordinary-session.stop')).toBeLessThan(h.events.indexOf('materialized.release'));
    expect(h.snapshots.some((snapshot) => snapshot.phase === 'running')).toBe(false);
    expect(h.snapshots.at(-1)?.phase).toBe('stopping');
  });

  it('recovers a committed materialization whose projection response was lost and stops before Agent admission', async () => {
    const f = fixture();
    const h = harness();
    const materializedProjection = {
      status: 'materialized' as const,
      activation: {
        state: 'materialized',
      },
      runtimeToken: 'runner-token',
      sealedBootstrap: 'sealed-bootstrap',
    };
    let projectionReads = 0;
    let endpointDeclines = 0;
    const control = createEphemeralRunnerHttpControlConnection({
      activationId: f.binding.activationId,
      pollIntervalMs: 0,
      createProjectionProof: () => ({ proof: true }),
      parseProjection: (value) => value as never,
      request: async (path, init, signal) => {
        if (path.endsWith('/endpoint/projection')) {
          projectionReads += 1;
          if (projectionReads === 1) {
            return await new Promise<never>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
          }
          return materializedProjection;
        }
        if (init.method === 'DELETE') {
          endpointDeclines += 1;
          return { status: 'unavailable', reason: 'already_materialized' };
        }
        throw new Error(`unexpected Runner control request: ${init.method} ${path}`);
      },
    });
    vi.mocked(h.deps.createConnection).mockImplementation(async () => ({
      ...control,
      claim: vi.fn(async ({ claim }) => { h.events.push('claim'); return claim; }),
      storeEndpointFacts: vi.fn(async () => { h.events.push('facts'); }),
      reportProgress: vi.fn(async ({ phase }) => { h.events.push(`progress.${phase}`); }),
      waitForReview: vi.fn(async () => { h.events.push('review'); return h.review; }),
      submitConsent: vi.fn(async () => { h.events.push('consent'); }),
      submitReadiness: vi.fn(async () => { h.events.push('readiness.publish'); }),
      onConnectionState: () => () => undefined,
    }));
    vi.mocked(h.deps.materialize).mockImplementation(async ({ launchManifestCommitment, signal }) => {
      h.events.push('materialize');
      await control.waitForMaterialization({ launchManifestCommitment, signal });
      return { sessionId: 'session-13' };
    });
    let agentAdmitted = false;
    const ordinarySessionStop = vi.fn(async () => {
      h.events.push('ordinary-session.stop');
      h.settleTerminal({ status: 'completed' });
    });
    vi.mocked(h.deps.startSession).mockImplementation(async ({ signal, onRuntimeStopReady }) => {
      h.events.push('runtime.bootstrap');
      onRuntimeStopReady(ordinarySessionStop);
      // The canonical runtime publishes its Stop owner before it admits the
      // selected Agent. A Stop that reconciles a lost materialization response
      // must therefore terminate the durable Session without spawning work.
      signal.throwIfAborted();
      agentAdmitted = true;
      return { terminal: h.terminal, stop: ordinarySessionStop };
    });
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    const running = controller.run();
    await vi.waitFor(() => expect(projectionReads).toBe(1));
    const firstStop = controller.stop();
    const repeatedStop = controller.stop();

    await expect(Promise.all([firstStop, repeatedStop])).resolves.toEqual([undefined, undefined]);
    await expect(running).resolves.toEqual({ status: 'cancelled' });
    expect(endpointDeclines).toBeGreaterThanOrEqual(1);
    expect(projectionReads).toBe(2);
    expect(agentAdmitted).toBe(false);
    expect(ordinarySessionStop).toHaveBeenCalledOnce();
    expect(h.deps.releaseMaterialized).toHaveBeenCalledOnce();
    expect(h.events.indexOf('ordinary-session.stop')).toBeLessThan(h.events.indexOf('materialized.release'));
  });

  it('waits for late Agent preparation, releases it, and performs no later effect after close', async () => {
    const f = fixture();
    const h = harness();
    let finishPreparation!: (preparation: { command: string }) => void;
    vi.mocked(h.deps.prepareAgent).mockImplementation(async () => {
      h.events.push('prepare');
      return await new Promise((resolve) => {
        finishPreparation = resolve;
      });
    });
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });
    const running = controller.run();
    await vi.waitFor(() => expect(h.events).toContain('prepare'));

    const closing = controller.requestClose();
    let closeSettled = false;
    void closing.finally(() => { closeSettled = true; });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(closeSettled).toBe(false);

    finishPreparation({ command: '/managed/codex' });
    await expect(closing).resolves.toBe('stopped');
    await expect(running).resolves.toEqual({ status: 'cancelled' });
    expect(h.deps.checkNonInferenceReadiness).not.toHaveBeenCalled();
    expect(h.deps.materialize).not.toHaveBeenCalled();
    expect(h.deps.startSession).not.toHaveBeenCalled();
    expect(h.events).toEqual(expect.arrayContaining([
      'prepare', 'preparation.release', 'connection.close', 'state.dispose',
    ]));
    expect([...f.activationSecretKey].every((byte) => byte === 0)).toBe(true);
  });

  it('binds the visible endpoint Stop control to the same confirmed close owner', async () => {
    const f = fixture();
    const h = harness();
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });
    const bound = vi.mocked(h.ui.bindControls).mock.calls[0]?.[0];
    expect(bound).toBeDefined();
    const running = controller.run();
    await vi.waitFor(() => expect(h.events).toContain('start'));
    await bound!.requestStop();
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(h.ui.confirmActiveClose).toHaveBeenCalledOnce();
    expect(h.events.filter((event) => event === 'runtime.stop')).toHaveLength(1);
  });

  it('releases prepared runtime custody when readiness fails before materialization', async () => {
    const f = fixture();
    const h = harness();
    vi.mocked(h.deps.checkNonInferenceReadiness).mockResolvedValue({
      status: 'unavailable',
      reason: 'broker readiness unavailable',
    });
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    await expect(controller.run()).resolves.toMatchObject({ status: 'failed' });
    expect(h.events).toEqual([
      'claim', 'facts', 'review', 'plugin.prepare', 'plugin.apply', 'consent', 'prepare',
      'progress.checking_ai_access', 'decline',
      'preparation.release', 'plugin.release', 'connection.close', 'state.dispose',
    ]);
    expect(h.deps.materialize).not.toHaveBeenCalled();
    expect(h.deps.startSession).not.toHaveBeenCalled();
    // This run already declined the activation above, and a retry would mint a
    // fresh box key and installation identity that the Home's single recorded
    // claim can never match. Offering Retry here sends the endpoint user into a
    // loop that fails identically every time.
    expect(h.snapshots.at(-1)).toMatchObject({ phase: 'failed', canRetry: false });
    expect(h.ui.requestFailureRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ canRetry: false }),
    );
    // No Session, Machine or AccessKey was ever created here, so the endpoint
    // must not send the user to an ordinary Session that does not exist.
    expect(h.snapshots.at(-1)?.failure).toEqual({ kind: 'before_session_terminal' });
    expect(h.ui.requestFailureRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ failure: { kind: 'before_session_terminal' } }),
    );
  });

  it('still offers retry when the run failed before any claim reached the Home', async () => {
    const f = fixture();
    const h = harness();
    vi.mocked(h.ui.requestFailureRecovery).mockResolvedValue('retry');
    vi.mocked(h.deps.createConnection).mockRejectedValue(new Error('runner_home_unreachable'));
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    await expect(controller.run()).resolves.toEqual({ status: 'retry_requested' });
    expect(h.events).not.toContain('decline');
    expect(h.snapshots.at(-1)).toMatchObject({ phase: 'failed', canRetry: true });
    expect(h.snapshots.at(-1)?.failure).toEqual({ kind: 'before_session' });
  });

  it('zeroizes activation signing custody when bounded local-state cleanup fails', async () => {
    const f = fixture();
    const h = harness();
    vi.mocked(h.deps.createConnection).mockRejectedValue(new Error('runner_home_unreachable'));
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: {
        homeDirectory: '/runner/home',
        endpointHomeDirectory: '/endpoint/home',
        environment: {},
        unsetEnvironmentVariables: [],
        dispose: vi.fn(async () => { throw new Error('runner_state_cleanup_failed'); }),
      },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    await expect(controller.run()).rejects.toThrow('runner_state_cleanup_failed');
    expect([...f.activationSecretKey].every((byte) => byte === 0)).toBe(true);
  });

  it('surfaces an unacknowledged ordinary runtime stop while still releasing local custody', async () => {
    const f = fixture();
    const h = harness();
    vi.mocked(h.deps.startSession).mockImplementation(async () => {
      h.events.push('start');
      return {
        terminal: h.terminal,
        stop: vi.fn(async () => {
          h.events.push('runtime.stop');
          throw new Error('session_stop_unacknowledged');
        }),
      };
    });
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });
    const running = controller.run();
    await vi.waitFor(() => expect(h.events).toContain('start'));

    await expect(controller.stop()).rejects.toThrow('session_stop_unacknowledged');
    h.settleTerminal({ status: 'completed' });
    await expect(running).resolves.toMatchObject({
      status: 'failed',
      error: expect.objectContaining({ message: 'session_stop_unacknowledged' }),
    });
    expect(h.events).toContain('materialized.release');
    expect(h.events.indexOf('runtime.stop')).toBeLessThan(h.events.indexOf('materialized.release'));
    expect(h.snapshots.at(-1)).toMatchObject({ phase: 'failed', canRetry: false });
    // A Session really does exist on this path, so pointing at it is truthful.
    expect(h.snapshots.at(-1)?.failure).toEqual({ kind: 'session_runtime_or_stop' });
  });

  it('shows the running window the Session runtime transport, not the activation connection', async () => {
    const f = fixture();
    const h = harness();
    let publishRuntimeConnection: ((state: 'connected' | 'reconnecting') => void) | null = null;
    vi.mocked(h.deps.startSession).mockImplementation(async ({ onRuntimeStopReady, onRuntimeConnectionState }) => {
      onRuntimeStopReady(async () => { h.events.push('runtime.stop'); });
      publishRuntimeConnection = onRuntimeConnectionState;
      h.events.push('start');
      return { terminal: h.terminal, stop: async () => { h.events.push('runtime.stop'); } };
    });
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => { h.events.push('state.dispose'); }) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });
    const running = controller.run();
    await vi.waitFor(() => expect(h.snapshots.at(-1)).toMatchObject({ phase: 'running', connection: 'connected' }));

    publishRuntimeConnection!('reconnecting');
    expect(h.snapshots.at(-1)).toMatchObject({ phase: 'running', connection: 'reconnecting' });
    publishRuntimeConnection!('connected');
    expect(h.snapshots.at(-1)).toMatchObject({ phase: 'running', connection: 'connected' });

    h.settleTerminal({ status: 'completed' });
    await expect(running).resolves.toMatchObject({ status: 'completed' });
  });

  it('reviews and installs the exact committed external plugin generation before consent is signed', async () => {
    const f = fixture();
    const h = harness();
    const pluginReview = { pluginId: 'acme.reviewed-external', displayName: 'Reviewed External', version: '1.2.3' };
    const apply = vi.fn(async () => { h.events.push('plugin.apply'); });
    const release = vi.fn(async () => { h.events.push('plugin.release'); });
    vi.mocked(h.deps.prepareReviewedPluginAcquisition).mockImplementation(async ({ homeDirectory }) => {
      h.events.push(`plugin.prepare:${homeDirectory}`);
      return { review: pluginReview as never, apply, release };
    });
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => undefined) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    const running = controller.run();
    await vi.waitFor(() => expect(h.events).toContain('start'));
    h.settleTerminal({ status: 'completed' });
    await expect(running).resolves.toEqual({ status: 'completed' });

    // The acquisition is prepared against the activation-local Home, its review
    // reaches the one consent surface, and the install lands before the consent
    // signature — so a failed install can still decline cleanly.
    expect(h.events).toContain('plugin.prepare:/runner/home');
    expect(h.ui.reviewAndRequestConsent).toHaveBeenCalledWith(
      expect.objectContaining({ pluginInstallation: pluginReview }),
    );
    expect(h.events.indexOf('plugin.apply')).toBeGreaterThan(h.events.indexOf('review'));
    expect(h.events.indexOf('plugin.apply')).toBeLessThan(h.events.indexOf('consent'));
    expect(h.events.indexOf('plugin.apply')).toBeLessThan(h.events.indexOf('prepare'));
  });

  it('declines without installing when the endpoint refuses the reviewed plugin', async () => {
    const f = fixture();
    const h = harness({ allow: false });
    const apply = vi.fn(async () => { h.events.push('plugin.apply'); });
    const release = vi.fn(async () => { h.events.push('plugin.release'); });
    vi.mocked(h.deps.prepareReviewedPluginAcquisition).mockImplementation(async () => ({
      review: { pluginId: 'acme.reviewed-external' } as never,
      apply,
      release,
    }));
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => undefined) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    await expect(controller.run()).resolves.toEqual({ status: 'declined' });
    expect(apply).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect(h.events).toContain('decline');
    expect(h.events).not.toContain('consent');
  });

  it('declines the activation when the committed generation cannot be installed', async () => {
    const f = fixture();
    const h = harness();
    vi.mocked(h.deps.prepareReviewedPluginAcquisition).mockImplementation(async () => ({
      review: { pluginId: 'acme.reviewed-external' } as never,
      apply: vi.fn(async () => { throw new Error('runner_reviewed_plugin_acquisition_failed'); }),
      release: vi.fn(async () => { h.events.push('plugin.release'); }),
    }));
    const controller = createEphemeralRunnerController({
      activation: f,
      home: { v: 1, homeServerIdentityId: 'srv_runner_home', canonicalServerUrl: 'https://home.example.test', revision: 1, endpoints: [{ kind: 'https', url: 'https://home.example.test' }] },
      localState: { homeDirectory: '/runner/home', endpointHomeDirectory: '/endpoint/home', environment: {}, unsetEnvironmentVariables: [], dispose: vi.fn(async () => undefined) },
      installation: f.installation,
      dependencies: h.deps,
      ui: h.ui,
    });

    await expect(controller.run()).resolves.toMatchObject({
      status: 'failed',
      error: expect.objectContaining({ message: 'runner_reviewed_plugin_acquisition_failed' }),
    });
    expect(h.events).toContain('decline');
    expect(h.events).not.toContain('consent');
    expect(h.deps.prepareAgent).not.toHaveBeenCalled();
  });
});
