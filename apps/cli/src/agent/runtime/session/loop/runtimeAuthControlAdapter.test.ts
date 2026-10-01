import { describe, expect, it, vi } from 'vitest';
import type { AgentSessionRuntimeAuthControl } from '@happier-dev/plugin-sdk/agents/runtime';
import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';
import { SOCKET_RPC_EVENTS } from '@happier-dev/protocol/socketRpc';
import { createApiSessionSocketStub } from '@/testkit/backends/apiSessionSocketHarness';
import { projectConnectedServiceRuntimeAuthTargetInput } from '@/daemon/connectedServices/runtimeAuth/projectRuntimeAuthTargetInput';
import { createResolvedSessionConnectedServiceAuthTransport } from '@/session/runtime/control/transport';
import { normalizeCodexConnectedServiceAuthGenerationRequest } from '../../../../../../../packages/plugins/codex/src/agent/auth/services/runtime/auth/generationRequest';
import { applyCodexConnectedServiceAuthGeneration } from '../../../../../../../packages/plugins/codex/src/agent/auth/services/runtime/auth/application';

const { createUserScopedSocket } = vi.hoisted(() => ({ createUserScopedSocket: vi.fn() }));
// The network socket is the genuine external boundary; the Session RPC codec and all
// host/provider identity projections remain real in the composed regression below.
vi.mock('@/api/session/sockets', () => ({ createUserScopedSocket }));

import { adaptAgentSessionRuntimeAuthControl } from './runtimeAuthControlAdapter';

describe('adaptAgentSessionRuntimeAuthControl', () => {
  it.each([
    { selectionKind: 'profile', serviceKey: 'happier.agent.codex/openai-codex', accepted: true },
    { selectionKind: 'group', serviceKey: 'happier.agent.codex/openai-codex', accepted: true },
    { selectionKind: 'profile', serviceKey: 'other.agent/openai-codex', accepted: false },
  ] as const)('admits only the owning service for host-produced $selectionKind identity $serviceKey through Session RPC', async ({ selectionKind, serviceKey, accepted }) => {
    const credential = buildConnectedServiceCredentialRecord({
      now: 1, serviceId: 'openai-codex', profileId: 'selected-account', kind: 'oauth',
      oauth: {
        accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', idToken: null,
        scope: null, tokenType: null, providerAccountId: 'provider-account', providerEmail: null,
      },
    });
    const providerRequest = vi.fn(async () => ({}));
    let acceptedSelection: unknown;
    const control = adaptAgentSessionRuntimeAuthControl({
      apply: async (request) => {
        const normalized = normalizeCodexConnectedServiceAuthGenerationRequest(request);
        if (!normalized) return { ok: false, error: 'invalid_request', errorCode: 'invalid_request' };
        const applied = await applyCodexConnectedServiceAuthGeneration({
          client: { request: providerRequest }, candidate: normalized.credential,
          forcedWorkspaceId: normalized.forcedWorkspaceId, forcedLoginMethod: normalized.forcedLoginMethod,
          refreshSelection: normalized.selection,
          updateRefreshSelection: (selection) => { acceptedSelection = selection; return () => {}; },
        });
        return applied.applied
          ? { ok: true, appliedVia: applied.appliedVia, activeAccountId: applied.activeAccountId }
          : { ok: false, error: applied.reason, errorCode: applied.reason };
      },
      readIdentity: async () => ({ ok: false, error: 'unused' }),
    });
    const socket = createApiSessionSocketStub({
      emit: (event, [envelope, acknowledge]) => {
        if (event !== SOCKET_RPC_EVENTS.CALL) return;
        const request = (envelope as { params: Parameters<NonNullable<typeof control.applyConnectedServiceAuthGeneration>>[0] }).params;
        void control.applyConnectedServiceAuthGeneration!(request).then((result) => {
          (acknowledge as (response: unknown) => void)({ ok: true, result });
        });
      },
    });
    createUserScopedSocket.mockReturnValue(socket);
    const transport = createResolvedSessionConnectedServiceAuthTransport({
      token: 'synthetic-token', sessionId: 'selected-session', mode: 'plain', ctx: null,
    });
    // This is the materializer's actual named shape: kind lives in binding.selection,
    // not in a fabricated top-level selection.kind field.
    const binding = selectionKind === 'group'
      ? { source: 'connected', selection: 'group', groupId: 'selected-group' }
      : { source: 'connected', selection: 'profile', profileId: 'selected-account' };
    const projected = projectConnectedServiceRuntimeAuthTargetInput({
      agentId: 'codex', fallbackSelection: {},
      materializedSelection: {
        serviceId: serviceKey, binding, profileId: 'selected-account',
        credential, credentialRevision: 'revision-2',
        ...(selectionKind === 'group' ? {
          groupId: 'selected-group', activeProfileId: 'selected-account',
          fallbackProfileId: 'selected-account', generation: 2,
        } : {}),
        applyConnectedServiceAuthGeneration: async (request: Parameters<typeof transport.applyConnectedServiceAuthGeneration>[0]) => {
          const result = await transport.applyConnectedServiceAuthGeneration(request);
          return result.ok ? result.value : { ok: false, error: result.error, errorCode: result.code };
        },
      },
    });

    if (!accepted) {
      await expect(projected.applySelectedAuthGeneration!()).resolves.toEqual({
        ok: false, error: 'invalid_request', errorCode: 'invalid_request',
      });
      expect(providerRequest).not.toHaveBeenCalled();
      return;
    }
    await expect(projected.applySelectedAuthGeneration!()).resolves.toEqual({
      ok: true, appliedVia: 'direct_live_hot_auth', activeAccountId: 'provider-account',
    });
    expect(providerRequest).toHaveBeenCalledWith('account/login/start', {
      type: 'chatgptAuthTokens', accessToken: 'synthetic-access', chatgptAccountId: 'provider-account',
    });
    expect(acceptedSelection).toMatchObject(selectionKind === 'group'
      ? { kind: 'group', groupId: 'selected-group', activeProfileId: 'selected-account', generation: 2 }
      : { kind: 'profile', profileId: 'selected-account' });
  });

  it('projects the private Session transport envelope into the bounded semantic facet', async () => {
    const apply = vi.fn<AgentSessionRuntimeAuthControl['apply']>(async (request) => ({
      ok: true,
      appliedVia: 'direct_live_hot_auth',
      activeAccountId: 'acct-1',
      verification: {
        proofStrength: 'exact',
        providerAccountId: 'acct-1',
        accountLabel: 'unused-apply-label@example.test',
        generationApplication: {
          serviceId: request.serviceId,
          groupId: 'group-1',
          profileId: 'profile-1',
          generation: 4,
          credentialRevision: 'revision-1',
          credentialFingerprint: 'sha256:12345678',
        },
        durability: {
          persisted: false,
          errorCode: 'unused_nested_durability',
        },
      },
      durability: {
        persisted: true,
      },
      accountLabel: 'unused-top-level-label@example.test',
      transportOnly: 'must-not-return',
    }));
    const readIdentity = vi.fn<AgentSessionRuntimeAuthControl['readIdentity']>(async () => ({
      ok: true,
      serviceId: 'plugin-supplied-service',
      identity: {
        strategy: 'provider_account_id',
        proofStrength: 'exact',
        providerAccountId: 'acct-1',
      },
      runtime: {
        safeToProbe: true,
        generation: 4,
      },
      transportOnly: 'must-not-return',
    }));
    const adapter = adaptAgentSessionRuntimeAuthControl({ apply, readIdentity });

    await expect(adapter.applyConnectedServiceAuthGeneration?.({
      serviceId: 'openai-codex',
      reason: 'manual',
      expected: {
        profileId: 'profile-1',
        generation: 4,
        transportOnly: 'must-not-reach-plugin',
      },
      authGeneration: {
        credential: { kind: 'oauth', accessToken: 'secret' },
      },
      transportOnly: 'must-not-reach-plugin',
    })).resolves.toEqual({
      ok: true,
      appliedVia: 'direct_live_hot_auth',
      activeAccountId: 'acct-1',
      verification: {
        proofStrength: 'exact',
        providerAccountId: 'acct-1',
        generationApplication: {
          serviceId: 'happier.agent.codex/openai-codex',
          groupId: 'group-1',
          profileId: 'profile-1',
          generation: 4,
          credentialRevision: 'revision-1',
          credentialFingerprint: 'sha256:12345678',
        },
      },
      durability: {
        persisted: true,
      },
    });
    expect(apply).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      reason: 'manual',
      expected: {
        profileId: 'profile-1',
        generation: 4,
      },
      authGeneration: {
        credential: { kind: 'oauth', accessToken: 'secret' },
      },
    });

    await expect(adapter.readConnectedServiceRuntimeIdentity?.({
      serviceId: 'openai-codex',
      reason: 'diagnostic',
      transportOnly: 'must-not-reach-plugin',
    })).resolves.toEqual({
      ok: true,
      serviceId: 'openai-codex',
      identity: {
        strategy: 'provider_account_id',
        proofStrength: 'exact',
        providerAccountId: 'acct-1',
      },
      runtime: {
        safeToProbe: true,
        generation: 4,
      },
    });
    expect(readIdentity).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      reason: 'diagnostic',
    });
  });

  it.each([
    { proofService: 'openai-codex', projectedService: 'happier.agent.codex/openai-codex' },
    { proofService: 'happier.agent.codex/openai-codex', projectedService: 'happier.agent.codex/openai-codex' },
    { proofService: 'other.agent/openai-codex', projectedService: 'other.agent/openai-codex' },
    { proofService: 'unknown-scalar', projectedService: null },
  ])('normalizes only known scalar generation proof identity $proofService', async ({ proofService, projectedService }) => {
    const adapter = adaptAgentSessionRuntimeAuthControl({
      apply: async () => ({
        ok: true, appliedVia: 'direct_live_hot_auth',
        verification: { proofStrength: 'exact', providerAccountId: 'acct-1', generationApplication: {
          serviceId: proofService, groupId: 'group-1', profileId: 'profile-1', generation: 4,
          credentialRevision: 'revision-1', credentialFingerprint: 'sha256:12345678',
        } },
      }),
      readIdentity: async () => ({ ok: false, error: 'unused' }),
    });
    const result = await adapter.applyConnectedServiceAuthGeneration!({
      serviceId: 'happier.agent.codex/openai-codex', reason: 'manual', authGeneration: { unused: true },
    });
    expect(result).toMatchObject({ ok: true, verification: { proofStrength: 'exact', providerAccountId: 'acct-1' } });
    if (!result.ok) throw new Error('apply failed');
    if (projectedService === null) expect(result.verification).not.toHaveProperty('generationApplication');
    else expect(result.verification).toHaveProperty('generationApplication.serviceId', projectedService);
  });

  it('rejects a non-JSON auth-generation payload before invoking the plugin', async () => {
    const apply = vi.fn<AgentSessionRuntimeAuthControl['apply']>();
    const readIdentity = vi.fn<AgentSessionRuntimeAuthControl['readIdentity']>();
    const adapter = adaptAgentSessionRuntimeAuthControl({ apply, readIdentity });

    await expect(adapter.applyConnectedServiceAuthGeneration?.({
      serviceId: 'openai-codex',
      reason: 'manual',
      authGeneration: { invalid: Symbol('not-json') },
    })).resolves.toEqual({
      ok: false,
      error: 'invalid_request',
      errorCode: 'invalid_request',
    });
    expect(apply).not.toHaveBeenCalled();
  });
});
