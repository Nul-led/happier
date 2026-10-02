import { describe, expect, it, vi } from 'vitest';

import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import { createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { callSessionRpc } from '@/session/transport/rpc/sessionRpc';
import { createConnectedServiceSessionAuthSwitchCore } from '../runtimeAuth/connectedServiceSessionAuthSwitchCore';
import { runSerializedConnectedServiceTransition } from './locking/runSerializedConnectedServiceTransition';


import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';
import { createCodexConnectedServiceRuntimeAuthAdapter } from '@/backends/codex/connectedServices/createCodexConnectedServiceRuntimeAuthAdapter';

import type { ConnectedServiceProviderRuntimeAuthAdapter } from '../runtimeAuth/types';
import { requestConnectedServiceSwitchBeforeTurnWithDeferral } from './connectedServiceSwitchBeforeTurnDeferral';
import { createConnectedServiceSwitchDeferralQueue } from './connectedServiceSwitchDeferralQueue';
import { createSessionConnectedServiceAuthHotApply } from './sessionConnectedServiceAuthHotApply';

const { createSessionScopedSocket } = vi.hoisted(() => ({ createSessionScopedSocket: vi.fn() }));
// Only the external Session RPC socket is substituted; adapter, RPC codec, queue and lock are real.
vi.mock('@/api/session/sockets', () => ({ createSessionScopedSocket }));

describe('createSessionConnectedServiceAuthHotApply', () => {
  it.each(['timeout', 'success'] as const)('retains one boundary budget and releases the actual session lock through Session RPC: %s', async outcome => {
    vi.useFakeTimers();
    const queue = createConnectedServiceSwitchDeferralQueue({ timeoutMs: 1000, disableDeferral: false });
    const core = createConnectedServiceSessionAuthSwitchCore();
    const requests: unknown[] = [];
    let providerBusy = true;
    createSessionScopedSocket.mockImplementation(() => createApiSessionSocketStub({
      emit: (event, [envelope, acknowledge]) => {
        if (event !== SOCKET_RPC_EVENTS.CALL) return;
        requests.push((envelope as { params: unknown }).params);
        (acknowledge as (result: unknown) => void)({ ok: true, result: providerBusy
          ? { ok: false, errorCode: 'turn_in_flight' }
          : { ok: true, appliedVia: 'direct_live_hot_auth' } });
      },
    }));
    const record = buildConnectedServiceCredentialRecord({ now: 1000, serviceId: 'openai-codex', profileId: 'work', kind: 'oauth', expiresAt: 2000,
      oauth: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', idToken: 'synthetic-id', scope: null, tokenType: null,
        providerAccountId: 'acct_work', providerEmail: null } });
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const apply = createSessionConnectedServiceAuthHotApply({ resolveRuntimeAuthAdapter: async () => adapter, turnDeferralQueue: queue });
    const input: Parameters<typeof apply>[0] = {
      tracked: { startedBy: 'daemon' as const, happySessionId: 'sess_1', pid: 123,
        spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'builtInAgent' as const, agentId: 'codex' as const } } },
      normalizedBindings: { v: 1 as const, bindingsByServiceId: {
        'openai-codex': { source: 'connected' as const, selection: 'profile' as const, profileId: 'work' },
      } },
      runtimeAuthSelectionsByServiceId: new Map([['openai-codex', { record,
        applyConnectedServiceAuthGeneration: async (request: unknown) => await callSessionRpc({
          token: 'synthetic-token', sessionId: 'sess_1', mode: 'plain',
          ctx: { encryptionKey: new Uint8Array(32), encryptionVariant: 'legacy' as const },
          method: SESSION_RPC_METHODS.SESSION_CONNECTED_SERVICE_AUTH_APPLY_GENERATION, request,
        }),
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
      expect(requests[0]).toMatchObject({ serviceId: 'openai-codex' });
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
        await expect(first).resolves.toEqual({ ok: true });
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
      queue.cancelSession('sess_1', 'session_terminated');
      await first;
      await second;
      createSessionScopedSocket.mockReset();
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
        tracked: { startedBy: 'daemon', happySessionId: 'sess_1', pid: 123, spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'builtInAgent', agentId: 'codex' } } },
        normalizedBindings: { v: 1, bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'first' },
          'openai': { source: 'connected', selection: 'profile', profileId: 'second' },
          'anthropic': { source: 'connected', selection: 'profile', profileId: 'third' },
        } },
      }).catch(error => ({ escaped: error }));
      await vi.waitFor(() => expect(hotApply).toHaveBeenCalledTimes(2));
      if (reason === 'timeout') await vi.advanceTimersByTimeAsync(1000);
      else if (reason === 'daemon_shutdown') await queue.cancelAll(reason);
      else await queue.cancelSession('sess_1', reason);
      await expect(outcome).resolves.toMatchObject({
        ok: false, errorCode: 'hot_apply_failed', serviceId: 'openai',
        serviceResultsByServiceId: {
          'openai-codex': { status: 'applied' },
          'openai': { status: 'failed', errorCode: 'hot_apply_failed' },
          'anthropic': { status: 'not_attempted' },
        },
      });
      await expect(outcome).resolves.toMatchObject({
        underlyingError: expect.stringContaining(`(code=${reason === 'timeout' ? 'switch_execution_timeout' : reason})`),
      });
      expect(hotApply).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it.each([{ selection: 'profile', superseded: false }, { selection: 'group', superseded: false }, { selection: 'group', superseded: true }] as const)('retries a busy $selection auth apply with currentness (superseded=$superseded)', async ({ selection, superseded }) => {
    const queue = createConnectedServiceSwitchDeferralQueue({ timeoutMs: 60000, disableDeferral: false });
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'task_started' });
    let providerBusy = true;
    let groupCurrent = true;
    const mutations: string[] = [];
    const adapter = createCodexConnectedServiceRuntimeAuthAdapter();
    const record = buildConnectedServiceCredentialRecord({ now: 1000, serviceId: 'openai-codex', profileId: 'work', kind: 'oauth', expiresAt: 2000,
      oauth: { accessToken: 'work-token', refreshToken: 'refresh', idToken: 'id', scope: null, tokenType: null,
        providerAccountId: 'acct_work', providerEmail: null } });
    const applyConnectedServiceAuthGeneration = vi.fn(async () => {
      if (providerBusy) return { ok: false, errorCode: 'turn_in_flight' };
      mutations.push('new-account');
      return { ok: true };
    });
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
      turnDeferralQueue: queue,
      validateGroupMutationCurrentness: async () => groupCurrent ? ({ current: true }) : ({ current: false }),
    });
    let settled = false;
    const pending = apply({
      tracked: { startedBy: 'daemon', happySessionId: 'sess_1', pid: 123,
        spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'builtInAgent', agentId: 'codex' } } },
      normalizedBindings: { v: 1, bindingsByServiceId: {
        'openai-codex': selection === 'group'
          ? { source: 'connected', selection: 'group', groupId: 'main', profileId: 'work' }
          : { source: 'connected', selection: 'profile', profileId: 'work' },
      } },
      runtimeAuthSelectionsByServiceId: new Map([['openai-codex', { record, applyConnectedServiceAuthGeneration, profileId: 'work', generation: 2, groupId: selection === 'group' ? 'main' : null }]]),
    }).then(result => { settled = true; return result; });
    await vi.waitFor(() => expect(applyConnectedServiceAuthGeneration).toHaveBeenCalledTimes(1));
    expect(queue.isTurnInFlight('sess_1')).toBe(true);
    expect(settled).toBe(false);
    expect(mutations).toEqual([]);
    providerBusy = false;
    groupCurrent = !superseded;
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'assistant_message_end' });
    if (superseded) {
      await expect(pending).resolves.toMatchObject({ ok: false, errorCode: 'credential_revision_superseded' });
      expect(mutations).toEqual([]);
    } else {
      await expect(pending).resolves.toEqual({ ok: true });
      expect(mutations).toEqual(['new-account']);
    }
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
        spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'builtInAgent' as const, agentId: 'codex' as const } } },
      normalizedBindings: { v: 1 as const, bindingsByServiceId: {
        'openai-codex': { source: 'connected' as const, selection: 'profile' as const, profileId: 'work' },
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
      tracked: { startedBy: 'daemon', happySessionId: 'sess_1', pid: 123, spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'builtInAgent', agentId: 'codex' } } },
      normalizedBindings: { v: 1, bindingsByServiceId: { 'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' } } },
    });
    await vi.waitFor(() => expect(hotApply).toHaveBeenCalledTimes(1));
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'assistant_message_end' });
    release({ applied: false, reason: 'turn_in_flight' });
    await expect(pending).resolves.toEqual({ ok: true });
    expect(hotApply).toHaveBeenCalledTimes(2);
    expect(queue.isTurnInFlight('sess_1')).toBe(false);
  });

  it('can await a native successor from inside an executing proactive switch', async () => {
    const queue = createConnectedServiceSwitchDeferralQueue({ timeoutMs: 1000, disableDeferral: false });
    let providerBusy = true;
    const hotApply = vi.fn(async () => providerBusy ? { applied: false, reason: 'turn_in_flight' } : { applied: true });
    const apply = createSessionConnectedServiceAuthHotApply({ resolveRuntimeAuthAdapter: async () => ({ hotApply } as unknown as ConnectedServiceProviderRuntimeAuthAdapter), turnDeferralQueue: queue });
    let result: unknown;
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'task_started' });
    await expect(requestConnectedServiceSwitchBeforeTurnWithDeferral({
      deferralQueue: queue, sessionId: 'sess_1', source: 'automatic', policy: 'defer_until_turn_boundary',
      target: { serviceId: 'openai-codex', profileId: 'work', groupId: '', generation: 0 },
      runSwitch: async () => {
        queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'task_started' });
        result = await apply({
          tracked: { startedBy: 'daemon', happySessionId: 'sess_1', pid: 123, spawnOptions: { directory: '/tmp/project', backendTarget: { kind: 'builtInAgent', agentId: 'codex' } } },
          normalizedBindings: { v: 1, bindingsByServiceId: { 'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' } } },
        });
      },
    })).resolves.toMatchObject({ status: 'deferred' });
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'assistant_message_end' });
    await vi.waitFor(() => expect(hotApply).toHaveBeenCalledTimes(1));
    expect(result).toBeUndefined();
    providerBusy = false;
    queue.recordTurnLifecycleEvent({ sessionId: 'sess_1', event: 'assistant_message_end' });
    await vi.waitFor(() => expect(result).toEqual({ ok: true }));
  });

  it('invokes the provider runtime auth adapter for connected bindings', async () => {
    const hotApply = vi.fn(async () => ({ applied: true }));
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply,
      recoverAfterRuntimeAuthSwitch: async () => ({}),
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
          backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
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
        binding: { source: 'connected', selection: 'profile', profileId: 'work' },
      }),
    });
  });

  it('returns failure when the provider runtime adapter rejects hot apply', async () => {
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply: async () => ({ applied: false, reason: 'not_ready' }),
      recoverAfterRuntimeAuthSwitch: async () => ({}),
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
          backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
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
      recoverAfterRuntimeAuthSwitch: async () => ({}),
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
          backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
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

  it('returns exact accepted verification from shared auth-surface hot-apply proof', async () => {
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply: async () => ({
        applied: true,
        verification: {
          status: 'verified',
          sharedAuthSurfaceId: 'claude-team',
          proofStrength: 'exact',
          source: 'runtime_identity_probe',
        },
      }),
      recoverAfterRuntimeAuthSwitch: async () => ({}),
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
          backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'claude-subscription': { source: 'connected', selection: 'group', groupId: 'claude-team' },
        },
      },
    })).resolves.toEqual({
      ok: true,
      verificationByServiceId: {
        'claude-subscription': {
          status: 'verified',
          sharedAuthSurfaceId: 'claude-team',
          proofStrength: 'exact',
          source: 'runtime_identity_probe',
        },
      },
    });
  });

  it('does not accept exact hot-apply proof without provider account identity material', async () => {
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply: async () => ({
        applied: true,
        verification: {
          status: 'verified',
          proofStrength: 'exact',
          source: 'applied_credential',
        },
      }),
      recoverAfterRuntimeAuthSwitch: async () => ({}),
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
          backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
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
      recoverAfterRuntimeAuthSwitch: async () => ({}),
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
          backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
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

  it('threads exact group currentness into the provider writer and reports typed supersession', async () => {
    const validateGroupMutationCurrentness = vi.fn(async () => ({
      current: false as const,
      authoritativeTarget: {
        profileId: 'current',
        generation: 9,
        credentialRevision: 'csr_9123456789ABCDEFGHJKMNPQRS' as const,
      },
    }));
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply: async (input) => {
        const currentness = await input.validateCurrentBeforeMutation?.();
        return currentness?.current === false
          ? { applied: false, status: 'superseded_after_apply' }
          : { applied: true };
      },
      recoverAfterRuntimeAuthSwitch: async () => ({}),
      probeQuota: async () => ({}),
      refreshActiveProfile: async () => ({}),
    } satisfies ConnectedServiceProviderRuntimeAuthAdapter;
    const apply = createSessionConnectedServiceAuthHotApply({
      resolveRuntimeAuthAdapter: async () => adapter,
      validateGroupMutationCurrentness,
    });

    await expect(apply({
      tracked: {
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'claude-subscription': {
            source: 'connected',
            selection: 'group',
            groupId: 'claude',
            profileId: 'stale',
          },
        },
      },
      runtimeAuthSelectionsByServiceId: new Map([[
        'claude-subscription',
        {
          groupId: 'claude',
          activeProfileId: 'stale',
          groupGeneration: 8,
          credentialRevision: 'csr_8123456789ABCDEFGHJKMNPQRS',
        },
      ]]),
    })).resolves.toMatchObject({
      ok: false,
      errorCode: 'credential_revision_superseded',
    });
    expect(validateGroupMutationCurrentness).toHaveBeenCalledWith({
      serviceId: 'claude-subscription',
      groupId: 'claude',
      profileId: 'stale',
      generation: 8,
      credentialRevision: 'csr_8123456789ABCDEFGHJKMNPQRS',
    });
  });

  it('reports per-service hot-apply progress when a later service fails', async () => {
    const hotApply = vi
      .fn()
      .mockResolvedValueOnce({ applied: true })
      .mockResolvedValueOnce({ applied: false, reason: 'not_ready' });
    const adapter = {
      classifyRuntimeAuthFailure: () => null,
      materializeActiveProfile: async () => ({}),
      canHotApply: () => ({ supported: true }),
      hotApply,
      recoverAfterRuntimeAuthSwitch: async () => ({}),
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
          backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
        },
      },
      normalizedBindings: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': { source: 'connected', selection: 'profile', profileId: 'work' },
          openai: { source: 'connected', selection: 'profile', profileId: 'api' },
        },
      },
    })).resolves.toEqual({
      ok: false,
      errorCode: 'hot_apply_failed',
      serviceId: 'openai',
      serviceResultsByServiceId: {
        'openai-codex': { status: 'applied' },
        openai: { status: 'failed', errorCode: 'hot_apply_failed' },
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
      recoverAfterRuntimeAuthSwitch: async () => ({}),
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
          backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
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
});
