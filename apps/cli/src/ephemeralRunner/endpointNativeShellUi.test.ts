import { describe, expect, it, vi } from 'vitest';

import type { RunnerLaunchManifestV1 } from '@happier-dev/protocol/ephemeralRunner/launchManifest';

import {
  createEphemeralRunnerNativeShellUi,
  type EphemeralRunnerNativeShellEvent,
  type EphemeralRunnerNativeShellRequest,
} from './endpointNativeShellUi';
import {
  resolveEphemeralRunnerActiveClosePresentation,
  resolveEphemeralRunnerConsentReviewPresentation,
  resolveEphemeralRunnerDirectoryChoicePresentation,
  resolveEphemeralRunnerFailureRecoveryPresentation,
  resolveEphemeralRunnerReviewedRuntimeFacts,
} from './endpointTerminalUi';

const reviewedManifest = {
  binding: {
    homeServerIdentityId: 'srv_acme_home',
    creatorAccountId: 'alice-account',
    artifact: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: 'b'.repeat(64) },
  },
  preparedAuthoring: {
    actionsSettings: { v: 1, actions: { 'session.activity.get': { enabled: false } } },
    authoring: {
      primaryTeamId: 'team-acme',
      agentTarget: { kind: 'agent', identity: { pluginId: 'dev.happier.codex', localId: 'codex' } },
      modelSelection: { kind: 'model', modelId: 'gpt-5.6' },
      permissionMode: 'safe-yolo',
    },
    composer: { text: 'exact prompt', references: [], attachments: [] },
    files: [{ id: 'file-1', name: 'trace.txt', mimeType: 'text/plain', sizeBytes: 42, sha256: 'a'.repeat(64) }],
    attachmentDestination: {
      uploadLocation: 'workspace',
      workspaceRelativeDir: '.happier/uploads',
      vcsIgnoreStrategy: 'git_info_exclude',
      vcsIgnoreWritesEnabled: true,
    },
  },
  endpointFacts: { v: 1, directory: '/workspace/exact', machine: { host: 'runner.example.test' } },
  displayFacts: { v: 1, homeId: 'srv_acme_home', homeName: 'Acme Home 🌍', requesterId: 'alice-account', requesterName: 'Alice Example', teamId: 'team-acme', teamName: '研究開発チーム' },
  machineContentKeyBinding: { v: 1, fingerprint: 'sealed-machine-key-fingerprint' },
  reviewedProviderModel: {
    selection: { kind: 'team_credential_provider_model', resourceId: 'resource-acme', teamId: 'team-acme', expectedResourceRevision: 7, agentTargetKey: 'agent:dev.happier.codex/codex', modelId: 'gpt-5.6' },
    descriptor: { id: 'gpt-5.6', name: 'GPT 5.6 Verified' },
    application: { agentTargetKey: 'agent:dev.happier.codex/codex', implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' }, endpointTemplateId: 'responses', protocol: 'openai-responses' },
    sourceRevision: 'source-revision-7', availability: 'available',
  },
  credentialSelectionBinding: {
    v: 1,
    resourceId: 'resource-acme',
    brokerMachineId: 'broker-machine',
    revision: 7,
    application: {
      agentTargetKey: 'agent:dev.happier.codex/codex',
      implementationIdentity: { pluginId: 'happier.provider.openai', localId: 'openai' },
      endpointTemplateId: 'responses',
      protocol: 'openai-responses',
    },
    sourceRevision: 'source-revision-7',
  },
} as unknown as RunnerLaunchManifestV1;

describe('ephemeral Runner native-shell adapter', () => {
  it('resolves one locale before sending closed native-shell presentation', async () => {
    const publish = vi.fn();
    const request = vi.fn(async () => ({
      v: 1 as const,
      type: 'directory_selected' as const,
      directory: '/Users/bob',
    }));
    const ui = createEphemeralRunnerNativeShellUi(
      { request, publish, subscribe: () => () => undefined },
      { locale: 'fr-CH' },
    );

    await ui.selectDirectory({ signal: new AbortController().signal });
    ui.present({ phase: 'running', connection: 'connected' });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      chooser: expect.objectContaining({ documentLanguage: 'fr', chooseLabel: 'Choisir un dossier' }),
    }), expect.any(AbortSignal));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      presentation: expect.objectContaining({
        documentLanguage: 'fr',
        status: 'L’Agent est en cours d’exécution',
      }),
    }));
  });

  it('sends the one canonical review projection and no sealed private review data', async () => {
    const requests: EphemeralRunnerNativeShellRequest[] = [];
    const request = vi.fn(async (message: EphemeralRunnerNativeShellRequest) => {
      requests.push(message);
      return { v: 1 as const, type: 'consent_decision' as const, decision: 'allow' as const };
    });
    const ui = createEphemeralRunnerNativeShellUi({ request, subscribe: () => () => undefined });

    await expect(ui.reviewAndRequestConsent({
      review: {
        manifest: reviewedManifest,
        launchManifestCommitment: 'launch-commitment',
        authoringCommitment: 'authoring-commitment',
        directory: '/workspace/exact',
      },
      signal: new AbortController().signal,
    })).resolves.toBe(true);

    // The native shell renders exactly what the terminal renders: one owner.
    expect(request).toHaveBeenCalledWith({
      v: 1,
      type: 'review',
      review: resolveEphemeralRunnerConsentReviewPresentation({
        manifest: reviewedManifest,
        directory: '/workspace/exact',
      }),
    }, expect.any(AbortSignal));

    // Sealed material stays with the endpoint controller; the shell is a renderer.
    const payload = JSON.stringify(requests[0]);
    expect(payload).not.toContain('sealed-private-descriptor');
    expect(payload).not.toContain('sealed-machine-key-fingerprint');
    expect(payload).not.toContain('runner.example.test');
  });

  it('delegates folder choice, window close, and persistent Stop through the confirmed-close owner', async () => {
    const request = vi.fn(async (message: { type: string }) => {
      if (message.type === 'choose_directory') return { v: 1 as const, type: 'directory_selected' as const, directory: '/Users/bob' };
      if (message.type === 'confirm_active_close') return { v: 1 as const, type: 'active_close_decision' as const, decision: 'keep_open' as const };
      throw new Error(`unexpected:${message.type}`);
    });
    const listener: { current: ((message: EphemeralRunnerNativeShellEvent) => void) | null } = { current: null };
    const ui = createEphemeralRunnerNativeShellUi({
      request,
      subscribe: (next) => { listener.current = next; return () => { listener.current = null; }; },
    });
    const requestStop = vi.fn(async () => {
      const decision = await ui.confirmActiveClose({
        phase: 'running',
        signal: new AbortController().signal,
      });
      return decision === 'keep_open' ? 'kept_open' as const : 'stopped' as const;
    });
    const unbind = ui.bindControls({ requestStop });

    await expect(ui.selectDirectory({ signal: new AbortController().signal })).resolves.toBe('/Users/bob');
    listener.current?.({ v: 1, type: 'close_requested' });
    await vi.waitFor(() => expect(requestStop).toHaveBeenCalledOnce());
    await expect(requestStop.mock.results[0]?.value).resolves.toBe('kept_open');
    expect(request).toHaveBeenCalledWith(
      {
        v: 1,
        type: 'confirm_active_close',
        phase: 'running',
        confirm: resolveEphemeralRunnerActiveClosePresentation({ phase: 'running' }),
      },
      expect.any(AbortSignal),
    );
    unbind();
    listener.current?.({ v: 1, type: 'stop_session' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestStop).toHaveBeenCalledOnce();
  });

  it('carries the resolved endpoint copy on every decision it asks the shell to render', async () => {
    const requests: EphemeralRunnerNativeShellRequest[] = [];
    const request = vi.fn(async (message: EphemeralRunnerNativeShellRequest) => {
      requests.push(message);
      if (message.type === 'choose_directory') return { v: 1 as const, type: 'directory_selected' as const, directory: '/Users/bob' };
      if (message.type === 'confirm_active_close') return { v: 1 as const, type: 'active_close_decision' as const, decision: 'keep_open' as const };
      return { v: 1 as const, type: 'failure_recovery_decision' as const, decision: 'exit' as const };
    });
    const ui = createEphemeralRunnerNativeShellUi({ request, subscribe: () => () => undefined });
    const signal = new AbortController().signal;

    await ui.selectDirectory({ signal });
    await ui.confirmActiveClose({ phase: 'running', signal });
    await ui.requestFailureRecovery({
      failure: { kind: 'before_session', message: 'The request could not be prepared. Check the activation and try again.' },
      canRetry: true,
      signal,
    });

    // The shell is a renderer. Every word it can show has to arrive from the one
    // endpoint presentation owner, or the shell becomes a second copy owner that
    // no locale or copy change can ever reach.
    expect(requests.map((message) => message.type))
      .toEqual(['choose_directory', 'confirm_active_close', 'failure_recovery']);
    expect(requests[0]).toMatchObject({
      chooser: resolveEphemeralRunnerDirectoryChoicePresentation(),
    });
    expect(requests[1]).toMatchObject({
      confirm: resolveEphemeralRunnerActiveClosePresentation({ phase: 'running' }),
    });
    expect(requests[2]).toMatchObject({
      recovery: resolveEphemeralRunnerFailureRecoveryPresentation({
        failure: { kind: 'before_session', message: 'The request could not be prepared. Check the activation and try again.' },
      }),
    });
    // The exact reviewed failure text reaches the shell, not a shell-side rewrite.
    expect(requests[2]).toMatchObject({
      recovery: { message: 'The request could not be prepared. Check the activation and try again.' },
    });
  });

  it('stops without waiting for a decision the dead shell can never answer', async () => {
    // The shell owns the only endpoint surface. If it is killed while a Session
    // is running, every outstanding decision is unanswerable, so the Runner must
    // stop instead of lingering with a live Session credential and child Agent.
    const request = vi.fn(async () => { throw new Error('runner_native_shell_disconnected'); });
    const listener: { current: ((message: EphemeralRunnerNativeShellEvent) => void) | null } = { current: null };
    const ui = createEphemeralRunnerNativeShellUi({
      request,
      subscribe: (next) => { listener.current = next; return () => { listener.current = null; }; },
    });
    const requestStop = vi.fn(async () => 'stopped' as const);
    ui.bindControls({ requestStop });

    listener.current?.({ v: 1, type: 'shell_disconnected' });

    await vi.waitFor(() => expect(requestStop).toHaveBeenCalledOnce());
    await expect(ui.confirmActiveClose({ phase: 'running', signal: new AbortController().signal }))
      .resolves.toBe('stop');
    await expect(ui.requestFailureRecovery({
      failure: { kind: 'session_runtime_or_stop', message: 'The Runner stopped before it could finish.' },
      canRetry: true,
      signal: new AbortController().signal,
    })).resolves.toBe('exit');
    await expect(ui.selectDirectory({ signal: new AbortController().signal })).resolves.toBeNull();
    await expect(ui.reviewAndRequestConsent({
      review: {
        manifest: {} as RunnerLaunchManifestV1,
        launchManifestCommitment: 'c',
        authoringCommitment: 'a',
        directory: '/workspace/exact',
      },
      signal: new AbortController().signal,
    })).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('sends only the canonical closed presentation to the shell', () => {
    const publish = vi.fn();
    const ui = createEphemeralRunnerNativeShellUi({
      request: vi.fn(),
      subscribe: () => () => undefined,
      publish,
    });

    ui.present({ phase: 'running', connection: 'connected' });

    expect(publish).toHaveBeenCalledWith({
      v: 1,
      type: 'presentation',
      presentation: expect.objectContaining({
        heading: 'Happier Runner',
        status: 'Agent is running',
        actions: [{ id: 'stop_session', label: 'Stop Session' }],
      }),
    });
  });

  it('publishes only the quiet reviewed facts once the request has been consented to', async () => {
    const publish = vi.fn();
    const ui = createEphemeralRunnerNativeShellUi({
      request: vi.fn(async () => ({ v: 1 as const, type: 'consent_decision' as const, decision: 'allow' as const })),
      subscribe: () => () => undefined,
      publish,
    });
    const published = () => publish.mock.calls.at(-1)?.[0].presentation;

    // Nothing is projected into the ambient surface before consent exists.
    ui.present({ phase: 'reviewing', connection: 'connected' });
    expect(published().facts).toEqual([]);

    await ui.reviewAndRequestConsent({
      review: {
        manifest: reviewedManifest,
        launchManifestCommitment: 'launch-commitment',
        authoringCommitment: 'authoring-commitment',
        directory: '/workspace/exact',
      },
      signal: new AbortController().signal,
    });
    ui.present({ phase: 'running', connection: 'connected' });

    expect(published().facts).toEqual(resolveEphemeralRunnerReviewedRuntimeFacts({
      manifest: reviewedManifest,
      directory: '/workspace/exact',
    }));
    // The consent-only material is projected exactly once, for the decision.
    const payload = JSON.stringify(published());
    expect(payload).toContain('/workspace/exact');
    expect(payload).not.toContain('exact prompt');
    expect(payload).not.toContain('a'.repeat(64));
    expect(payload).not.toContain('sealed-private-descriptor');
  });
});
