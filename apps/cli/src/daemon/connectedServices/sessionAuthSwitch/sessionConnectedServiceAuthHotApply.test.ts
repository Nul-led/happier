import { describe, expect, it, vi } from 'vitest';

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import { createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { createResolvedSessionConnectedServiceAuthTransport } from '@/session/runtime/control/transport';
import { projectAgentConnectedAccountLaunchCatalogEntry } from '@/plugins/projection/registry/agentCatalogEntryHooks';
import { createCodexConnectedAccountNativeAuthCodec, createCodexConnectedServiceRuntimeAuthAdapter } from '../../../../../../packages/plugins/codex/src/agent/auth/services/runtime/control/runtimeAuthAdapter';
import { codexStateSharingDescriptor } from '../../../../../../packages/plugins/codex/src/agent/auth/services/state/sharing/descriptor';
import { createConnectedServiceSessionAuthSwitchCore } from '../runtimeAuth/connectedServiceSessionAuthSwitchCore';
import { runSerializedConnectedServiceTransition } from './locking/runSerializedConnectedServiceTransition';



import type { ConnectedServiceProviderRuntimeAuthAdapter } from '../runtimeAuth/types';
import { createConnectedServiceSwitchDeferralQueue } from './connectedServiceSwitchDeferralQueue';
import { createSessionConnectedServiceAuthHotApply } from './sessionConnectedServiceAuthHotApply';

const { createUserScopedSocket } = vi.hoisted(() => ({ createUserScopedSocket: vi.fn() }));
// Only the external Session RPC socket is substituted; plugin adapter/projection, codec, queue and lock are real.
vi.mock('@/api/session/sockets', () => ({ createUserScopedSocket }));

describe('createSessionConnectedServiceAuthHotApply', () => {
  it.each(['timeout', 'success'] as const)('retains one boundary budget and releases the actual session lock through Session RPC: %s', async outcome => {
    vi.useFakeTimers();
    const queue = createConnectedServiceSwitchDeferralQueue({ timeoutMs: 1000, disableDeferral: false });
    const core = createConnectedServiceSessionAuthSwitchCore();
    const requests: unknown[] = [];
    const root = await mkdtemp(join(tmpdir(), 'auth-boundary-budget-'));
    const serviceId = 'happier.agent.codex/openai-codex';
    let providerBusy = true;
    createUserScopedSocket.mockImplementation(() => createApiSessionSocketStub({
      emit: (event, [envelope, acknowledge]) => {
        if (event !== SOCKET_RPC_EVENTS.CALL) return;
        requests.push((envelope as { params: unknown }).params);
        (acknowledge as (result: unknown) => void)({ ok: true, result: providerBusy
          ? { ok: false, errorCode: 'turn_in_flight', error: 'turn_in_flight' }
          : { ok: true, serviceId: 'happier.agent.codex/openai-codex', appliedVia: 'direct_live_hot_auth' } });
      },
    }));
    const record = buildConnectedServiceCredentialRecord({ now: 1000, serviceId: 'openai-codex', profileId: 'work', kind: 'oauth', expiresAt: 2000,
      oauth: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', idToken: 'synthetic-id', scope: null, tokenType: null,
        providerAccountId: 'acct_work', providerEmail: null } });
    const transport = createResolvedSessionConnectedServiceAuthTransport({ token: 'synthetic-token', sessionId: 'sess_1', mode: 'plain', ctx: null });
    const entry = projectAgentConnectedAccountLaunchCatalogEntry({ agentId: 'codex', isCurrent: () => true,
      connectedAccountLaunch: { stateSharingDescriptor: codexStateSharingDescriptor, continuity: {
        nativeAuthCodec: createCodexConnectedAccountNativeAuthCodec(), runtimeAuthAdapter: createCodexConnectedServiceRuntimeAuthAdapter(),
      } },
    });
    const adapter = await entry.getConnectedServiceRuntimeAuthAdapter!();
    const apply = createSessionConnectedServiceAuthHotApply({ resolveRuntimeAuthAdapter: async () => adapter, turnDeferralQueue: queue });
    const input: Parameters<typeof apply>[0] = {
      tracked: { startedBy: 'daemon' as const, happySessionId: 'sess_1', pid: 123,
        spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'backend' as const, backendId: 'codex', sourceKind: 'built_in' as const } } },
      normalizedBindings: { v: 1 as const, bindingsByServiceId: {
        [serviceId]: { source: 'connected' as const, selection: 'profile' as const, profileId: 'work' },
      } },
      runtimeAuthSelectionsByServiceId: new Map([[serviceId, { serviceId, credential: record, profileId: 'work',
        nativeHome: {
          readFiles: async () => ({ 'auth.json': await readFile(join(root, 'auth.json')) }),
          replaceFiles: async (files: Readonly<Record<string, Uint8Array>>) => {
            for (const [fileId, bytes] of Object.entries(files)) await writeFile(join(root, fileId), bytes);
          },
        },
        applyConnectedServiceAuthGeneration: async (request: Parameters<typeof transport.applyConnectedServiceAuthGeneration>[0]) => {
          const result = await transport.applyConnectedServiceAuthGeneration(request);
          return result.ok ? result.value : { ok: false, error: result.error, errorCode: result.code };
        },
      }]]),
    };
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'task_started' });
    let settled: unknown;
    const first = runSerializedConnectedServiceTransition({ core, sessionId: 'sess_1', reason: 'manual', execute: async () => await apply(input) })
      .then(result => { settled = result; return result; });
    let nextEntered = false;
    let second: Promise<void> | undefined;
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({ serviceId: serviceId });
      second = runSerializedConnectedServiceTransition({ core, sessionId: 'sess_1', reason: 'manual', execute: async () => { nextEntered = true; } });
      await vi.advanceTimersByTimeAsync(800);
      queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'assistant_message_end' });
      queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'task_started' });
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toHaveLength(2);
      expect(nextEntered).toBe(false);
      if (outcome === 'success') {
        providerBusy = false;
        queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'assistant_message_end' });
        await expect(first).resolves.toMatchObject({ ok: true });
        expect(JSON.parse(await readFile(join(root, 'auth.json'), 'utf8')).tokens.access_token).toBe('synthetic-access');
      } else {
        await vi.advanceTimersByTimeAsync(200);
        expect(settled).toMatchObject({ ok: false, errorCode: 'hot_apply_failed', underlyingError: expect.stringContaining('(code=switch_execution_timeout)') });
        expect(queue.isTurnInFlight('sess_1')).toBe(true);
        await first;
      }
      await second;
      expect(nextEntered).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await queue.cancelSession('sess_1', 'session_terminated');
      await first;
      await second;
      await rm(root, { recursive: true, force: true });
      createUserScopedSocket.mockReset();
      vi.useRealTimers();
    }
  });

  it.each(['timeout', 'session_terminated', 'daemon_shutdown'] as const)('preserves earlier service effects when boundary waiting fails on %s', async (reason) => {
    vi.useFakeTimers();
    try {
      const queue = createConnectedServiceSwitchDeferralQueue({ timeoutMs: 1000, disableDeferral: false });
      queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'task_started' });
      const hotApply = vi.fn().mockResolvedValueOnce({ applied: true }).mockResolvedValue({ applied: false, reason: 'turn_in_flight' });
      const apply = createSessionConnectedServiceAuthHotApply({
        resolveRuntimeAuthAdapter: async () => ({ hotApply } as unknown as ConnectedServiceProviderRuntimeAuthAdapter),
        turnDeferralQueue: queue,
      });
      const outcome = apply({
        tracked: { startedBy: 'daemon', happySessionId: 'sess_1', pid: 123, spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'backend' as const, backendId: 'codex', sourceKind: 'built_in' as const } } },
        normalizedBindings: { v: 1, bindingsByServiceId: {
          'happier.agent.codex/openai-codex': { source: 'connected', selection: 'profile', profileId: 'first' },
          'happier.provider.openai/openai': { source: 'connected', selection: 'profile', profileId: 'second' },
          'happier.provider.anthropic/anthropic': { source: 'connected', selection: 'profile', profileId: 'third' },
        } },
      }).catch(error => ({ escaped: error }));
      await vi.waitFor(() => expect(hotApply).toHaveBeenCalledTimes(2));
      if (reason === 'timeout') await vi.advanceTimersByTimeAsync(1000);
      else if (reason === 'daemon_shutdown') await queue.cancelAll(reason);
      else await queue.cancelSession('sess_1', reason);
      await expect(outcome).resolves.toMatchObject({
        ok: false, errorCode: 'hot_apply_failed', serviceId: 'happier.provider.openai/openai',
        serviceResultsByServiceId: {
          'happier.agent.codex/openai-codex': { status: 'applied' },
          'happier.provider.openai/openai': { status: 'failed', errorCode: 'hot_apply_failed' },
          'happier.provider.anthropic/anthropic': { status: 'not_attempted' },
        },
      });
      await expect(outcome).resolves.toMatchObject({
        underlyingError: expect.stringContaining(`(code=${reason === 'timeout' ? 'switch_execution_timeout' : reason})`),
      });
      expect(hotApply).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('releases concurrent auth callers at the same canonical boundary', async () => {
    const queue = createConnectedServiceSwitchDeferralQueue({ timeoutMs: 1000, disableDeferral: false });
    let providerBusy = true;
    const hotApply = vi.fn(async () => providerBusy
      ? { applied: false, reason: 'turn_in_flight' }
      : { applied: true });
    const adapter = { hotApply } as unknown as ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({ resolveRuntimeAuthAdapter: async () => adapter, turnDeferralQueue: queue });
    const input = {
      tracked: { startedBy: 'daemon' as const, happySessionId: 'sess_1', pid: 123,
        spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'backend' as const, backendId: 'codex', sourceKind: 'built_in' as const } } },
      normalizedBindings: { v: 1 as const, bindingsByServiceId: {
        'happier.agent.codex/openai-codex': { source: 'connected' as const, selection: 'profile' as const, profileId: 'work' },
      } },
    };
    const first = apply(input);
    const second = apply(input);
    await vi.waitFor(() => expect(hotApply).toHaveBeenCalledTimes(2));
    providerBusy = false;
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'assistant_message_end' });
    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(hotApply).toHaveBeenCalledTimes(4);
    expect(queue.isTurnInFlight('sess_1')).toBe(false);
  });

  it('retries immediately when completion arrives before a delayed busy reply', async () => {
    const queue = createConnectedServiceSwitchDeferralQueue({ timeoutMs: 1000, disableDeferral: false });
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'task_started' });
    let release!: (result: { applied: boolean; reason: string }) => void;
    const hotApply = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({ applied: true });
    const apply = createSessionConnectedServiceAuthHotApply({ resolveRuntimeAuthAdapter: async () => ({ hotApply } as unknown as ConnectedServiceProviderRuntimeAuthAdapter), turnDeferralQueue: queue });
    const pending = apply({
      tracked: { startedBy: 'daemon', happySessionId: 'sess_1', pid: 123, spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' } } },
      normalizedBindings: { v: 1, bindingsByServiceId: { 'happier.agent.codex/openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' } } },
    });
    await vi.waitFor(() => expect(hotApply).toHaveBeenCalledTimes(1));
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'assistant_message_end' });
    release({ applied: false, reason: 'turn_in_flight' });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(hotApply).toHaveBeenCalledTimes(2);
    expect(queue.isTurnInFlight('sess_1')).toBe(false);
  });

  it('infers the provider from webhook metadata when startup-drained tracked sessions have no spawn options', async () => {
    const hotApply = vi.fn(async () => ({ applied: true }));
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply,
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const resolveRuntimeAuthAdapter = vi.fn(async () => adapter);
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        happySessionMetadataFromLocalWebhook: {
          path: '/tmp/project',
          host: 'host',
          homeDir: '/home/user',
          happyHomeDir: '/home/user/.happy',
          happyLibDir: '/home/user/.happy/lib',
          happyToolsDir: '/home/user/.happy/tools',
          codexSessionId: 'codex-session-1',
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
        },
      },
    })).resolves.toEqual({ ok: true });

    expect(resolveRuntimeAuthAdapter).toHaveBeenCalledWith('codex');
    expect(hotApply).toHaveBeenCalledOnce();
  });

  it('invokes the provider runtime auth adapter for connected bindings', async () => {
    const hotApply = vi.fn(async () => ({ applied: true }));
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply,
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
        },
      },
    })).resolves.toEqual({ ok: true });

    expect(hotApply).toHaveBeenCalledWith({
      target: { agentId: 'codex' },
      selection: expect.objectContaining({
        serviceId: 'openai-codex',
        profileId: 'work',
      }),
    });
  });

  it('returns exact accepted verification from provider runtime hot-apply proof', async () => {
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply: async () => ({
        applied: true,
        verification: {
          activeAccountId: 'acct_work',
          proofStrength: 'exact',
          source: 'applied_credential',
        },
      }),
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
        },
      },
    })).resolves.toEqual({
      ok: true,
      verificationByServiceId: {
        'openai-codex': {
          status: 'verified',
          activeAccountId: 'acct_work',
          proofStrength: 'exact',
          source: 'applied_credential',
        },
      },
    });
  });

  it('preserves the complete provider-remeasured generation application proof', async () => {
    const credentialRevision = 'csr_abcdefghijklmnopqrstuv';
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply: async () => ({
        applied: true,
        verification: {
          status: 'verified',
          sharedAuthSurfaceId: 'group-1',
          proofStrength: 'exact',
          source: 'claude_native_credentials',
          credentialRevision,
          credentialFingerprint: 'fingerprint-1',
          generationApplication: {
            serviceId: 'claude-subscription',
            groupId: 'group-1',
            profileId: 'profile-1',
            generation: 7,
            credentialRevision,
            credentialFingerprint: 'fingerprint-1',
          },
        },
      }),
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({ resolveRuntimeAuthAdapter: async () => adapter });

    await expect(apply({
      tracked: {
        startedBy: 'daemon', happySessionId: 'sess_1', pid: 123,
        spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'backend', backendId: 'claude', sourceKind: 'built_in' } },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'claude-subscription': { source: 'connected', selection: 'group', groupId: 'group-1', profileId: 'profile-1' },
        },
      },
    })).resolves.toMatchObject({
      ok: true,
      verificationByServiceId: {
        'claude-subscription': {
          credentialRevision,
          credentialFingerprint: 'fingerprint-1',
          generationApplication: { generation: 7, credentialRevision, credentialFingerprint: 'fingerprint-1' },
        },
      },
    });
  });

  it('threads authoritative group currentness into the provider lock and reports supersession', async () => {
    const credentialRevision = 'csr_abcdefghijklmnopqrstuv';
    const authoritativeCredentialRevision = 'csr_2123456789ABCDEFGHJKMNPQRS';
    const validateGroupMutationCurrentness = vi.fn(async () => ({
      current: false as const,
      reason: 'credential_revision_superseded',
      authoritativeTarget: {
        profileId: 'profile-current',
        generation: 8,
        credentialRevision: authoritativeCredentialRevision,
      },
    }));
    const hotApply = vi.fn(async (request: Parameters<ConnectedServiceProviderRuntimeAuthAdapter['hotApply']>[0]) => {
      const currentness = await request.validateCurrentBeforeMutation?.();
      return currentness?.current === false
        ? { applied: false, status: 'superseded_after_apply' as const, reason: currentness.reason }
        : { applied: true };
    });
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply,
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
      validateGroupMutationCurrentness,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon', happySessionId: 'sess_1', pid: 123,
        spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'backend', backendId: 'claude', sourceKind: 'built_in' } },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'claude-subscription': { source: 'connected', selection: 'group', groupId: 'group-1', profileId: 'profile-1' },
        },
      },
      runtimeAuthSelectionsByServiceId: new Map([['claude-subscription', {
        serviceId: 'claude-subscription',
        groupId: 'group-1',
        activeProfileId: 'profile-1',
        groupGeneration: 7,
        credentialRevision,
      }]]),
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'credential_revision_superseded',
      serviceId: 'claude-subscription',
    });
    expect(validateGroupMutationCurrentness).toHaveBeenCalledWith({
      serviceId: 'claude-subscription',
      groupId: 'group-1',
      profileId: 'profile-1',
      generation: 7,
      credentialRevision,
    });
    expect(hotApply).toHaveBeenCalledWith(expect.objectContaining({
      validateCurrentBeforeMutation: expect.any(Function),
    }));
  });

  it('does not accept exact hot-apply proof without identity material', async () => {
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply: async () => ({
        applied: true,
        verification: {
          proofStrength: 'exact',
          source: 'applied_credential',
        },
      }),
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
        },
      },
    })).resolves.toEqual({ ok: true });
  });

  it('returns failure when the provider runtime adapter rejects hot apply', async () => {
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply: async () => ({ applied: false, reason: 'not_ready' }),
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
        },
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'hot_apply_failed',
      serviceId: 'openai-codex',
      serviceResultsByServiceId: {
        'openai-codex': { status: 'failed', errorCode: 'hot_apply_failed' },
      },
    });
  });

  it('returns restart-required when the provider can recover a hot-apply miss by restart', async () => {
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply: async () => ({
        applied: false,
        reason: 'transport_invalidation_failed',
        recovery: 'restart_resume',
      }),
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
        },
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'hot_apply_restart_required',
      serviceId: 'openai-codex',
      serviceResultsByServiceId: {
        'openai-codex': { status: 'failed', errorCode: 'hot_apply_restart_required' },
      },
    });
  });

  it('returns restart-required when provider reports partial direct-live hot auth', async () => {
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply: async () => ({
        applied: false,
        appliedVia: 'direct_live_hot_auth',
        partialState: 'runtime_auth_partially_applied',
        activeAccountId: 'acct-work',
        reason: 'auth_store_persistence_failed_after_live_apply',
        recovery: 'restart_resume',
      }),
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
        },
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'hot_apply_restart_required',
      serviceId: 'openai-codex',
      serviceResultsByServiceId: {
        'openai-codex': { status: 'failed', errorCode: 'hot_apply_restart_required' },
      },
    });
  });

  it('prefers materialized runtime auth selections when provided', async () => {
    const hotApply = vi.fn(async () => ({ applied: true }));
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply,
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
    });
    const selection = {
      serviceId: 'openai-codex',
      profileId: 'work',
      record: { profileId: 'work' },
      invalidateTransports: async () => undefined,
    };

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
        },
      },
      runtimeAuthSelectionsByServiceId: new Map([['openai-codex', selection]]),
    })).resolves.toEqual({ ok: true });

    expect(hotApply).toHaveBeenCalledWith({
      target: { agentId: 'codex' },
      selection: {
        serviceId: 'openai-codex',
        profileId: 'work',
      },
    });
  });

  it('applies only requested connected service bindings when a switch scope is provided', async () => {
    const hotApply = vi.fn(async () => ({ applied: true }));
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply,
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
          openai: { source: 'connected', selection: 'profile', profileId: 'api' },
        },
      },
      serviceIds: new Set(['openai-codex']),
    })).resolves.toEqual({ ok: true });

    expect(hotApply).toHaveBeenCalledOnce();
    expect(hotApply).toHaveBeenCalledWith(expect.objectContaining({
      selection: expect.objectContaining({ serviceId: 'openai-codex' }),
    }));
  });

  it('reports per-service hot-apply progress when a later service fails', async () => {
    const hotApply = vi.fn(async (request: Parameters<ConnectedServiceProviderRuntimeAuthAdapter['hotApply']>[0]) => {
      const selection = request.selection && typeof request.selection === 'object' && !Array.isArray(request.selection)
        ? request.selection as Readonly<Record<string, unknown>>
        : {};
      return selection.serviceId === 'openai'
        ? { applied: false, reason: 'not_ready' }
        : { applied: true };
    });
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply,
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
          openai: { source: 'connected', selection: 'profile', profileId: 'api' },
        },
      },
      serviceIds: new Set(['openai-codex', 'openai']),
    })).resolves.toEqual({
      ok: false,
      errorCode: 'hot_apply_failed',
      serviceId: 'openai',
      serviceResultsByServiceId: {
        'openai-codex': { status: 'applied' },
        openai: { status: 'failed', errorCode: 'hot_apply_failed' },
      },
    });

    expect(hotApply).toHaveBeenCalledTimes(2);
  });
});
