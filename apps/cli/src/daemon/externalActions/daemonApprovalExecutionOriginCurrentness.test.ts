import { describe, expect, it, vi } from 'vitest';
import tweetnacl from 'tweetnacl';

import {
  API_TOKEN_FULL_GRANT_V1,
  SessionAgentSpawnPolicyV1Schema,
  signExternalActionApprovalInputV1,
  type ApprovalExecutionOriginV1,
  type ApprovalRequestV2,
} from '@happier-dev/protocol';

import { createDaemonApprovalExecutionOriginCurrentness } from './daemonExternalActionTargetResolver';

const origin: ApprovalExecutionOriginV1 = {
  v: 1,
  authority: 'account_automation',
  surface: 'api',
  caller: { kind: 'host' },
  serverId: 'home-1',
  accountId: 'account-1',
  principalId: 'account-1',
  credentialId: '11111111-1111-4111-8111-111111111111',
  sessionId: 'session-1',
  target: { kind: 'session', sessionId: 'session-1' },
  actionId: 'session.message.send',
  requestId: 'request-1',
};

describe('daemon approval execution-origin currentness', () => {
  it('binds an unsigned origin to its current local Home profile without conflating it with the cryptographic Home id', async () => {
    const resolveCurrentMachineExecutionOriginContext = vi.fn(async () => ({
      serverIdentityId: 'srv-cryptographic-home', machineId: 'machine-1',
    }));
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      resolveCurrentMachineExecutionOriginContext,
      resolveTarget: async () => origin.target ?? null,
      listAccountApiTokens: async () => ({
        tokens: [{
          tokenId: origin.credentialId!,
          label: 'automation',
          displayPrefix: 'hap_v1_11111111',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
          lastUsedAt: null,
          hasEncryptionAccess: false,
          hasUnattendedTeamAccess: false,
          grant: API_TOKEN_FULL_GRANT_V1,
          parentTokenId: null,
          activeChildCount: 0,
          embedConfig: null,
        }],
      }),
    });

    const localOrigin: ApprovalExecutionOriginV1 = { ...origin, surface: 'cli' };
    await expect(isCurrent({ origin: localOrigin })).resolves.toBe(true);
    await expect(isCurrent({ origin: { ...localOrigin, serverId: 'other-profile' } })).resolves.toBe(false);
  });

  it('accepts a different current-device routing profile only for the same cryptographic Home identity', async () => {
    const keyPair = tweetnacl.sign.keyPair();
    const actionArgs = { sessionId: 'session-1', message: 'approved exact input' };
    const authorization = {
      v: 1 as const,
      token: 'opaque-home-authorization',
      binding: {
        serverIdentityId: 'srv-cryptographic-home',
        accountId: 'account-1',
        principalId: 'principal-1',
        credentialId: '11111111-1111-4111-8111-111111111111',
        grant: API_TOKEN_FULL_GRANT_V1,
        machineId: 'machine-1',
        actionId: 'approval.request.create',
        requestId: 'request-1',
        requestEnvelopeDigest: 'A'.repeat(43),
        target: { kind: 'machine' as const, machineId: 'machine-1' },
      },
    };
    const externalOrigin = {
      ...origin,
      serverId: 'creator-local-profile-id',
      serverIdentityId: authorization.binding.serverIdentityId,
      principalId: authorization.binding.principalId,
      machineId: 'machine-1',
      externalActionExecutionAuthorization: authorization,
      externalActionInputSignature: signExternalActionApprovalInputV1({
        authorizationToken: authorization.token,
        actionId: origin.actionId,
        target: origin.target!,
        input: actionArgs,
        privateKey: keyPair.secretKey,
      }),
    } as ApprovalExecutionOriginV1;
    const request: ApprovalRequestV2 = {
      v: 2,
      status: 'approved',
      createdAtMs: 1,
      updatedAtMs: 2,
      createdBy: { surface: 'system' },
      executionOriginV1: externalOrigin,
      actionId: externalOrigin.actionId,
      actionArgs,
      summary: 'approval',
      decision: { kind: 'approve', decidedAtMs: 2 },
    };
    const verifyExternalExecutionAuthorization = vi.fn(async () => true);
    const resolveCurrentMachineExecutionOriginContext = vi.fn(async () => ({
      serverIdentityId: 'srv-cryptographic-home', machineId: 'machine-1',
    }));
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'current-device-profile-id',
      resolveCurrentMachineExecutionOriginContext,
      resolveTarget: async () => origin.target ?? null,
      listAccountApiTokens: async () => ({ tokens: [{
        tokenId: authorization.binding.credentialId,
        label: 'automation',
        displayPrefix: 'hap_v1_11111111',
        createdAt: '2026-09-01T00:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        hasEncryptionAccess: false,
        hasUnattendedTeamAccess: false,
        grant: API_TOKEN_FULL_GRANT_V1,
        parentTokenId: null,
        activeChildCount: 0,
        embedConfig: null,
      }] }),
      externalActionMachinePublicKey: keyPair.publicKey,
      verifyExternalExecutionAuthorization,
    });

    await expect(isCurrent({ origin: externalOrigin, request })).resolves.toBe(true);
    expect(verifyExternalExecutionAuthorization).toHaveBeenCalledOnce();

    resolveCurrentMachineExecutionOriginContext.mockResolvedValueOnce({
      serverIdentityId: 'srv-wrong-home', machineId: 'machine-1',
    });
    await expect(isCurrent({ origin: externalOrigin, request })).resolves.toBe(false);
    expect(verifyExternalExecutionAuthorization).toHaveBeenCalledOnce();
  });

  it('replays an external approval only through its signed exact input, target, and Home currentness proof', async () => {
    const keyPair = tweetnacl.sign.keyPair();
    const actionArgs = { sessionId: 'session-1', message: 'approved exact input' };
    const authorization = {
      v: 1 as const,
      token: 'opaque-home-authorization',
      binding: {
        serverIdentityId: 'home-1',
        accountId: 'account-1',
        principalId: 'principal-1',
        credentialId: '11111111-1111-4111-8111-111111111111',
        grant: API_TOKEN_FULL_GRANT_V1,
        machineId: 'machine-1',
        actionId: 'approval.request.create',
        requestId: 'request-1',
        requestEnvelopeDigest: 'A'.repeat(43),
        target: { kind: 'machine' as const, machineId: 'machine-1' },
      },
    };
    const externalOrigin: ApprovalExecutionOriginV1 = {
      ...origin,
      serverIdentityId: authorization.binding.serverIdentityId,
      principalId: authorization.binding.principalId,
      machineId: 'machine-1',
      externalActionExecutionAuthorization: authorization,
      externalActionInputSignature: signExternalActionApprovalInputV1({
        authorizationToken: authorization.token,
        actionId: origin.actionId,
        target: origin.target!,
        input: actionArgs,
        privateKey: keyPair.secretKey,
      }),
    };
    const request: ApprovalRequestV2 = {
      v: 2,
      status: 'approved',
      createdAtMs: 1,
      updatedAtMs: 2,
      createdBy: { surface: 'system' },
      executionOriginV1: externalOrigin,
      actionId: externalOrigin.actionId,
      actionArgs,
      summary: 'approval',
      decision: { kind: 'approve', decidedAtMs: 2 },
    };
    const resolveCurrentMachineExecutionOriginContext = vi.fn(async () => ({
      serverIdentityId: 'home-1', machineId: 'machine-1',
    }));
    const resolveTarget = vi.fn();
    const listAccountApiTokens = vi.fn();
    const verifyExternalExecutionAuthorization = vi.fn(async () => true);
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      resolveCurrentMachineExecutionOriginContext,
      resolveTarget,
      listAccountApiTokens,
      externalActionMachinePublicKey: keyPair.publicKey,
      verifyExternalExecutionAuthorization,
    });

    await expect(isCurrent({ origin: externalOrigin, request })).resolves.toBe(true);
    expect(verifyExternalExecutionAuthorization).toHaveBeenCalledWith({
      authorization,
      effectActionId: 'session.message.send',
      target: { kind: 'session', sessionId: 'session-1' },
    });
    expect(resolveCurrentMachineExecutionOriginContext).toHaveBeenCalledOnce();
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(listAccountApiTokens).not.toHaveBeenCalled();

    await expect(isCurrent({
      origin: externalOrigin,
      request: { ...request, actionArgs: { ...actionArgs, message: 'substituted' } },
    })).resolves.toBe(false);
    expect(verifyExternalExecutionAuthorization).toHaveBeenCalledTimes(1);
  });

  it('keeps nested contributed PAT approval replay bound to the admitted plugin generation', async () => {
    const keyPair = tweetnacl.sign.keyPair();
    const actionArgs = { v: 1, teamId: 'team-1', membershipId: 'membership-1' };
    const target = { kind: 'machine' as const, machineId: 'machine-1' };
    const authorization = {
      v: 1 as const,
      token: 'opaque-compound-action-authorization',
      binding: {
        serverIdentityId: 'home-1',
        accountId: 'account-1',
        principalId: 'account-1',
        credentialId: '11111111-1111-4111-8111-111111111111',
        grant: { ...API_TOKEN_FULL_GRANT_V1, actions: { families: [], ids: ['acme.external/actions/archive-member'] } },
        machineId: 'machine-1',
        actionId: 'action.invoke',
        requestId: 'request-plugin-1',
        requestEnvelopeDigest: 'A'.repeat(43),
        target,
      },
    };
    const externalPluginOrigin: ApprovalExecutionOriginV1 = {
      v: 1,
      authority: 'account_automation',
      surface: 'api',
      caller: {
        kind: 'plugin',
        pluginId: 'acme.external',
        contributionLocalId: 'archive-member',
        sourceCustody: { kind: 'development', registeredRootId: 'external-root' },
      },
      serverId: 'home-1',
      serverIdentityId: 'home-1',
      accountId: 'account-1',
      principalId: 'account-1',
      credentialId: authorization.binding.credentialId,
      machineId: 'machine-1',
      target,
      actionId: 'teams.members.remove',
      requestId: authorization.binding.requestId,
      externalActionExecutionAuthorization: authorization,
      externalActionInputSignature: signExternalActionApprovalInputV1({
        authorizationToken: authorization.token,
        actionId: 'teams.members.remove',
        target,
        input: actionArgs,
        privateKey: keyPair.secretKey,
      }),
    };
    const request: ApprovalRequestV2 = {
      v: 2,
      status: 'approved',
      createdAtMs: 1,
      updatedAtMs: 2,
      // Descriptive `createdBy` uses the display surfaces the canonical schema
      // admits ('api' maps to 'system'); `requestedSurface` must equal the
      // immutable execution-origin surface.
      createdBy: {
        surface: 'system',
        pluginId: 'acme.external',
        contributionLocalId: 'archive-member',
      },
      requestedSurface: 'api',
      executionOriginV1: externalPluginOrigin,
      actionId: externalPluginOrigin.actionId,
      actionArgs,
      summary: 'approval',
      decision: { kind: 'approve', decidedAtMs: 2 },
    };
    const resolveCurrentPluginSourceCustody = vi.fn(async () => ({
      kind: 'development' as const,
      registeredRootId: 'external-root',
    }));
    const verifyExternalExecutionAuthorization = vi.fn(async () => true);
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      resolveCurrentMachineExecutionOriginContext: async () => ({
        serverIdentityId: 'home-1', machineId: 'machine-1',
      }),
      resolveTarget: async () => target,
      listAccountApiTokens: async () => ({ tokens: [{
        tokenId: authorization.binding.credentialId,
        label: 'automation',
        displayPrefix: 'hap_v1_11111111',
        createdAt: '2026-09-01T00:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        hasEncryptionAccess: false,
        hasUnattendedTeamAccess: false,
        grant: API_TOKEN_FULL_GRANT_V1,
        parentTokenId: null,
        activeChildCount: 0,
        embedConfig: null,
      }] }),
      externalActionMachinePublicKey: keyPair.publicKey,
      verifyExternalExecutionAuthorization,
      resolveCurrentPluginSourceCustody,
    });

    await expect(isCurrent({ origin: externalPluginOrigin, request })).resolves.toBe(true);
    expect(verifyExternalExecutionAuthorization).toHaveBeenCalledOnce();
    expect(resolveCurrentPluginSourceCustody).toHaveBeenCalledWith('acme.external');

    resolveCurrentPluginSourceCustody.mockResolvedValueOnce({
      kind: 'development',
      registeredRootId: 'replacement-root',
    });
    await expect(isCurrent({ origin: externalPluginOrigin, request })).resolves.toBe(false);
    expect(verifyExternalExecutionAuthorization).toHaveBeenCalledTimes(2);

    await expect(isCurrent({
      origin: {
        ...externalPluginOrigin,
        externalActionExecutionAuthorization: undefined,
        externalActionInputSignature: undefined,
      },
      request,
    })).resolves.toBe(false);
    expect(verifyExternalExecutionAuthorization).toHaveBeenCalledTimes(2);
  });

  it('rejects a legacy external-PAT approval origin without the complete signed invocation binding', async () => {
    const resolveCurrentMachineExecutionOriginContext = vi.fn(async () => ({
      serverIdentityId: 'home-1', machineId: 'machine-1',
    }));
    const resolveTarget = vi.fn(async () => origin.target ?? null);
    const listAccountApiTokens = vi.fn(async () => ({
      tokens: [{
        tokenId: origin.credentialId!,
        label: 'automation',
        displayPrefix: 'hap_v1_11111111',
        createdAt: '2026-09-01T00:00:00.000Z',
        lastUsedAt: null,
        expiresAt: null,
        hasEncryptionAccess: false,
        hasUnattendedTeamAccess: false,
        grant: API_TOKEN_FULL_GRANT_V1,
        parentTokenId: null,
        activeChildCount: 0,
        embedConfig: null,
      }],
    }));
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      resolveCurrentMachineExecutionOriginContext,
      resolveTarget,
      listAccountApiTokens,
    });

    await expect(isCurrent({ origin })).resolves.toBe(false);
    expect(resolveCurrentMachineExecutionOriginContext).not.toHaveBeenCalled();
    expect(resolveTarget).not.toHaveBeenCalled();
    expect(listAccountApiTokens).not.toHaveBeenCalled();
  });

  it('fails closed when any current owner is unavailable or the PAT is expired', async () => {
    const listAccountApiTokens = vi.fn(async () => ({
      tokens: [{
        tokenId: origin.credentialId!,
        label: 'expired',
        displayPrefix: 'hap_v1_11111111',
        createdAt: '2026-08-01T00:00:00.000Z',
        lastUsedAt: null,
        expiresAt: '2026-09-01T00:00:00.000Z',
        hasEncryptionAccess: false,
        hasUnattendedTeamAccess: false,
        grant: API_TOKEN_FULL_GRANT_V1,
        parentTokenId: null,
        activeChildCount: 0,
        embedConfig: null,
      }],
    }));
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      now: () => Date.parse('2026-09-08T00:00:00.000Z'),
      resolveCurrentMachineExecutionOriginContext: async () => ({
        serverIdentityId: 'home-1', machineId: 'machine-1',
      }),
      resolveTarget: async () => ({ kind: 'session', sessionId: 'session-1' }),
      listAccountApiTokens,
    });

    await expect(isCurrent({ origin })).resolves.toBe(false);
    listAccountApiTokens.mockRejectedValueOnce(new Error('unavailable'));
    await expect(isCurrent({ origin })).resolves.toBe(false);
  });

  it('requires an authenticated current Account owner even for a host machine origin without a PAT', async () => {
    const listAccountApiTokens = vi.fn(async () => ({ tokens: [] }));
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      resolveCurrentMachineExecutionOriginContext: async () => ({
        serverIdentityId: 'home-1', machineId: 'machine-1',
      }),
      resolveTarget: async () => ({ kind: 'machine', machineId: 'machine-1' }),
      listAccountApiTokens,
    });
    const hostMachineOrigin: ApprovalExecutionOriginV1 = {
      ...origin,
      principalId: undefined,
      credentialId: undefined,
      sessionId: undefined,
      machineId: 'machine-1',
      target: { kind: 'machine', machineId: 'machine-1' },
    };

    await expect(isCurrent({ origin: hostMachineOrigin })).resolves.toBe(true);
    listAccountApiTokens.mockRejectedValueOnce(new Error('account_disabled'));
    await expect(isCurrent({ origin: hostMachineOrigin })).resolves.toBe(false);
  });

  it('requires a plugin caller to retain its admitted source custody', async () => {
    const resolveCurrentPluginSourceCustody = vi.fn(async () => ({
      kind: 'development' as const,
      registeredRootId: 'notes-root',
    }) as { kind: 'development'; registeredRootId: string } | null);
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      resolveCurrentMachineExecutionOriginContext: async () => ({
        serverIdentityId: 'home-1', machineId: 'machine-1',
      }),
      resolveTarget: async () => ({ kind: 'machine', machineId: 'machine-1' }),
      listAccountApiTokens: async () => ({ tokens: [] }),
      resolveCurrentPluginSourceCustody,
    });
    const pluginOrigin: ApprovalExecutionOriginV1 = {
      v: 1,
      authority: 'account_automation',
      surface: 'plugin',
      caller: {
        kind: 'plugin',
        pluginId: 'acme.notes',
        contributionLocalId: 'save-note',
        sourceCustody: { kind: 'development', registeredRootId: 'notes-root' },
      },
      serverId: 'home-1',
      accountId: 'account-1',
      machineId: 'machine-1',
      target: { kind: 'machine', machineId: 'machine-1' },
      actionId: 'session.message.send',
      requestId: 'request-plugin-1',
    };

    await expect(isCurrent({ origin: pluginOrigin })).resolves.toBe(true);
    resolveCurrentPluginSourceCustody.mockResolvedValueOnce(null);
    await expect(isCurrent({ origin: pluginOrigin })).resolves.toBe(false);
    resolveCurrentPluginSourceCustody.mockResolvedValueOnce({
      kind: 'development',
      registeredRootId: 'replacement-root',
    });
    await expect(isCurrent({ origin: pluginOrigin })).resolves.toBe(false);
  });

  it('rejects an Automation approval after its canonical worker occurrence is no longer current', async () => {
    const isAutomationRunCurrent = vi.fn(async () => true);
    const additionalOwners = { isAutomationRunCurrent };
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      resolveCurrentMachineExecutionOriginContext: async () => ({
        serverIdentityId: 'home-1', machineId: 'machine-1',
      }),
      resolveTarget: async () => ({ kind: 'machine', machineId: 'machine-1' }),
      listAccountApiTokens: async () => ({ tokens: [] }),
      ...additionalOwners,
    });
    const automationOrigin: ApprovalExecutionOriginV1 = {
      v: 1,
      authority: 'account_automation',
      surface: 'agent',
      caller: {
        kind: 'automationRun',
        runId: 'automation-run-1',
        automationId: 'automation-1',
        cause: { kind: 'manual', invokedAt: 1 },
      },
      serverId: 'home-1',
      accountId: 'account-1',
      machineId: 'machine-1',
      runId: 'automation-run-1',
      target: { kind: 'machine', machineId: 'machine-1' },
      actionId: 'session.message.send',
      requestId: 'request-automation-1',
    };

    await expect(isCurrent({ origin: automationOrigin })).resolves.toBe(true);
    expect(isAutomationRunCurrent).toHaveBeenCalledWith({
      kind: 'automationRun',
      runId: 'automation-run-1',
      automationId: 'automation-1',
      cause: { kind: 'manual', invokedAt: 1 },
    });
    isAutomationRunCurrent.mockResolvedValueOnce(false);
    await expect(isCurrent({ origin: automationOrigin })).resolves.toBe(false);
  });

  it('rechecks a Workflow approval principal through the live admission owner and fails closed without it', async () => {
    const authorization = {
      admittedPermissionCeiling: 'safe-yolo' as const,
      principal: {
        kind: 'api' as const,
        accountId: 'account-1',
        principalId: 'principal-1',
        credentialId: 'credential-1',
      },
    };
    const workflowOrigin: ApprovalExecutionOriginV1 = {
      v: 1,
      authority: 'account_automation',
      surface: 'agent',
      caller: { kind: 'workflowRun', runId: 'workflow-run-1', authorization },
      serverId: 'home-1',
      accountId: 'account-1',
      machineId: 'machine-1',
      runId: 'workflow-run-1',
      // Every Workflow step stamps its admitted ceiling as caller permission
      // (`daemonRuntime.ts` `buildActionContext`); a Run has no Session mode.
      callerPermissionMode: authorization.admittedPermissionCeiling,
      target: { kind: 'machine', machineId: 'machine-1' },
      actionId: 'session.message.send',
      requestId: 'request-workflow-1',
    };
    const baseOwners = {
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      resolveCurrentMachineExecutionOriginContext: async () => ({
        serverIdentityId: 'home-1', machineId: 'machine-1',
      }),
      resolveTarget: async () => ({ kind: 'machine' as const, machineId: 'machine-1' }),
      listAccountApiTokens: async () => ({ tokens: [] }),
    };

    // No admission owner means the principal cannot be rechecked at all.
    await expect(createDaemonApprovalExecutionOriginCurrentness(baseOwners)({ origin: workflowOrigin }))
      .resolves.toBe(false);

    const isWorkflowRunAuthorizationCurrent = vi.fn(async () => true);
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      ...baseOwners,
      isWorkflowRunAuthorizationCurrent,
    });
    await expect(isCurrent({ origin: workflowOrigin })).resolves.toBe(true);
    // The exact accepted authorization the durable origin carries reaches the
    // live owner unchanged; the Run identity is never used as the principal.
    expect(isWorkflowRunAuthorizationCurrent).toHaveBeenCalledWith({ authorization });
    isWorkflowRunAuthorizationCurrent.mockResolvedValueOnce(false);
    await expect(isCurrent({ origin: workflowOrigin })).resolves.toBe(false);
  });

  it('rejects replay when current Session or Run permission no longer admits the captured effective mode', async () => {
    const resolveCurrentPermissionMode = vi.fn(async (): Promise<string | null> => 'yolo');
    const additionalOwners = { resolveCurrentPermissionMode };
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      resolveCurrentMachineExecutionOriginContext: async () => ({
        serverIdentityId: 'home-1', machineId: 'machine-1',
      }),
      resolveTarget: async () => ({ kind: 'session', sessionId: 'session-1' }),
      listAccountApiTokens: async () => ({ tokens: [] }),
      ...additionalOwners,
    });
    const permissionOrigin: ApprovalExecutionOriginV1 = {
      ...origin,
      principalId: undefined,
      credentialId: undefined,
      callerPermissionMode: 'yolo',
      causalPermissionAuthority: {
        kind: 'admittedSessionInputV1',
        admittedPermissionCeiling: 'safe-yolo',
      },
    };

    await expect(isCurrent({ origin: permissionOrigin })).resolves.toBe(true);
    resolveCurrentPermissionMode.mockResolvedValueOnce('read-only');
    await expect(isCurrent({ origin: permissionOrigin })).resolves.toBe(false);
    resolveCurrentPermissionMode.mockResolvedValueOnce(null);
    await expect(isCurrent({ origin: permissionOrigin })).resolves.toBe(false);

    resolveCurrentPermissionMode.mockResolvedValueOnce('yolo');
    await expect(isCurrent({
      origin: {
        ...permissionOrigin,
        callerPermissionMode: 'safe-yolo',
        causalPermissionAuthority: undefined,
      },
    })).resolves.toBe(true);
    resolveCurrentPermissionMode.mockResolvedValueOnce('read-only');
    await expect(isCurrent({
      origin: {
        ...permissionOrigin,
        callerPermissionMode: 'safe-yolo',
        causalPermissionAuthority: undefined,
      },
    })).resolves.toBe(false);
  });

  it('fails Agent spawn replay closed when its captured policy is absent or newly narrowed', async () => {
    const approvedPolicy = SessionAgentSpawnPolicyV1Schema.parse({});
    const resolveCurrentSessionAgentSpawnPolicyV1 = vi.fn(async () => approvedPolicy);
    const isCurrent = createDaemonApprovalExecutionOriginCurrentness({
      accountId: 'account-1',
      machineId: 'machine-1',
      serverId: 'home-1',
      resolveCurrentMachineExecutionOriginContext: async () => ({
        serverIdentityId: 'home-1', machineId: 'machine-1',
      }),
      resolveTarget: async () => ({ kind: 'session', sessionId: 'session-1' }),
      listAccountApiTokens: async () => ({ tokens: [] }),
      resolveCurrentSessionAgentSpawnPolicyV1,
    });
    const spawnOrigin: ApprovalExecutionOriginV1 = {
      ...origin,
      surface: 'agent',
      principalId: undefined,
      credentialId: undefined,
      actionId: 'session.spawn_new',
    };

    await expect(isCurrent({ origin: spawnOrigin })).resolves.toBe(false);
    await expect(isCurrent({
      origin: { ...spawnOrigin, sessionAgentSpawnPolicyV1: approvedPolicy },
    })).resolves.toBe(true);
    resolveCurrentSessionAgentSpawnPolicyV1.mockResolvedValueOnce({
      ...approvedPolicy,
      allowCrossMachine: false,
    });
    await expect(isCurrent({
      origin: { ...spawnOrigin, sessionAgentSpawnPolicyV1: approvedPolicy },
    })).resolves.toBe(false);
  });
});
