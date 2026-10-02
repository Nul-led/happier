import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountSettingsParse, createActionExecutor, createWorkflowAccountRunActionOwner,
  normalizeActionsSettingsV1, sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
  serializeWorkflowStoredContentEnvelopeV1, validateWorkflowDefinition,
  type ActionExecutorDeps,
} from '@happier-dev/protocol';
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager';
import { registerMachineRpcHandlers } from '@/api/machine/rpcHandlers';
import { createWorkflowRunStorageTestkit } from '@/daemon/workflows/workflowRunStorage.testkit';

const boundary = vi.hoisted(() => ({ send: vi.fn(), get: vi.fn() }));
// Expo and HTTP are genuine outward boundaries; the notification policy and
// Action host composition stay real.
vi.mock('expo-server-sdk', () => ({ Expo: class {
  chunkPushNotifications(messages: unknown[]) { return [messages]; }
  sendPushNotificationsAsync(messages: unknown[]) { return boundary.send(messages); }
  static isExpoPushToken() { return true; }
} }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: boundary.get } };
});

import { createCliActionDeps } from './createCliActionDeps';
import { createCliActionExecutor } from './createCliActionExecutor';
import { createDaemonSessionAccountActionExecutor } from '@/daemon/agentRuntime/createDaemonSessionAccountActionExecutor';

function hostParams(settings = accountSettingsParse({}), workflowAction?: ActionExecutorDeps['workflowAction']) {
  return {
    token: 'account-token', credentials: { token: 'account-token', encryption: null },
    sessionId: 'session-1', mode: 'plain' as const, ctx: null,
    actionsSettingsProvider: { getAccountSettings: () => settings,
      getActionsSettings: () => normalizeActionsSettingsV1(settings.actionsSettingsV1) },
    ...(workflowAction ? { workflowAction } : {}),
  };
}

function host(settings = accountSettingsParse({}), workflowAction?: ActionExecutorDeps['workflowAction']) {
  return createCliActionDeps(hostParams(settings, workflowAction));
}

describe('CLI Notify me host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    boundary.send.mockResolvedValue([{ status: 'ok', id: 'push-ticket' }]);
    boundary.get.mockImplementation(async (url: string) => ({ data: url.endsWith('/v1/push-tokens')
      ? { tokens: [{ id: 'device-1', token: 'ExponentPushToken[test]', createdAt: 1, updatedAt: 1 }] }
      : { badgeCount: 0 } }));
  });

  it('dispatches through policy and suppresses a replay with the same Action request id', async () => {
    const deps = host();
    const input = { message: 'Deployment ready', title: 'Deploy', channels: ['builtin:expo_push'] };
    const context = { surface: 'cli' as const, actionRequestId: 'notification-host-replay-1' };
    await expect(deps.notificationsNotifyMe?.(input, context)).resolves.toEqual({ attemptedChannels: 1, deliveredChannels: 1 });
    await expect(deps.notificationsNotifyMe?.(input, context)).resolves.toEqual({ attemptedChannels: 0, deliveredChannels: 0 });
    expect(boundary.send.mock.calls[0]?.[0]).toMatchObject([{ title: 'Deploy', body: 'Deployment ready' }]);
    expect(boundary.send).toHaveBeenCalledTimes(1);
  });

  it('runs authenticated Session notifications through agent policy and refuses non-Account placement', async () => {
    const execute = createDaemonSessionAccountActionExecutor({ serverId: 'home',
      createExecutor: () => createCliActionExecutor(hostParams(accountSettingsParse({ actionsSettingsV1: {
        v: 1, actions: { 'notifications.notify_me': { disabledSurfaces: ['agent'] } },
      } }))) });
    const authority = { sessionId: 'session-1', isCurrent: async () => true };
    const witness = { turnId: 'turn-1', inputId: 'input-1', userMessageSeq: 1, userMessageSeqs: [1] };
    await expect(execute({ kind: 'action.execute', requestId: 'session-notify',
      actionId: 'notifications.notify_me', input: { message: 'ready', channels: ['builtin:expo_push'] }, witness }, authority))
      .resolves.toMatchObject({ ok: false, errorCode: 'action_disabled' });
    await expect(execute({ kind: 'action.execute', requestId: 'foreign-placement',
      actionId: 'session.message.send', input: { text: 'hello' }, witness }, authority))
      .resolves.toMatchObject({ ok: false, errorCode: 'target_unavailable' });
    expect(boundary.send).not.toHaveBeenCalled();
    const allowed = createDaemonSessionAccountActionExecutor({ serverId: 'home',
      createExecutor: () => createCliActionExecutor(hostParams()) });
    await expect(allowed({ kind: 'action.execute', requestId: 'session-notify-allowed',
      actionId: 'notifications.notify_me', input: { message: 'ready', channels: ['builtin:expo_push'] }, witness }, authority))
      .resolves.toEqual({ ok: true, result: { attemptedChannels: 1, deliveredChannels: 1 } });
    await expect(allowed({ kind: 'action.execute', requestId: 'missing-depth',
      actionId: 'workflow.trigger.add', input: {}, witness }, authority))
      .resolves.toMatchObject({ ok: false, errorCode: 'target_unavailable', details: { reason: 'turn_depth_unavailable' } });
    await expect(allowed({ kind: 'action.execute', requestId: 'stale-session',
      actionId: 'notifications.notify_me', input: { message: 'ready' }, witness },
      { ...authority, isCurrent: async () => false }))
      .resolves.toMatchObject({ ok: false, errorCode: 'target_unavailable' });
    expect(boundary.send).toHaveBeenCalledTimes(1);
  });

  it('composes a workflow leaf default link and deduplicates its replay through the real Run owner', async () => {
    const runId = '11111111-1111-4111-8111-111111111111';
    const definition = validateWorkflowDefinition({ version: 1,
      defaults: { agentTarget: { kind: 'agent', identity: { pluginId: 'happier.agent.test', localId: 'test' } } },
      blocks: ['work'],
    }).normalizedDefinition!;
    const storage = createWorkflowRunStorageTestkit({ runId, machineId: 'machine-a', origin: { kind: 'direct' },
      acceptedEnvelope: serializeWorkflowStoredContentEnvelopeV1(sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
        mode: 'plain', binding: { v: 1, purpose: 'accepted_snapshot', accountId: 'account-1', runId },
        acceptedSnapshot: { definition, startedBy: 'user', authoredDefinition: definition,
          materializedLeaves: [], frozenChildren: {}, metadata: null, workDepth: 0,
          source: { kind: 'saved', definitionId: 'def-1', revision: { headerVersion: 1, bodyVersion: 1 }, savedBy: null },
          inputs: {}, machineId: 'machine-a', executionTarget: { kind: 'session' },
          workspaceTarget: { project: { machineId: 'machine-a', directory: '/repo', checkoutRootPath: '/repo' } },
          origin: { kind: 'direct', originSessionId: 'origin-1' },
          authorization: { admittedPermissionCeiling: 'safe-yolo', principal: { kind: 'host' } },
        },
      })),
    });
    const runOwner = createWorkflowAccountRunActionOwner({
      resolveAccountId: async () => 'account-1', storage,
      // Artifact storage is an unused boundary for a retained Run read.
      definitions: { get: async () => { throw new Error('must_not_read_mutable_definition'); } },
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      normalizeAbsolutePath: (directory) => directory.startsWith('/') ? directory : null,
      randomBytes: () => { throw new Error('plain_account_does_not_need_keys'); },
    });
    const executor = createActionExecutor(host(accountSettingsParse({}), async (args) => {
      if (args.actionId !== 'workflow.run.get') throw new Error('unexpected_workflow_operation');
      return await runOwner.execute(args);
    }));
    const input = { message: 'Panel finished', title: 'Review', channels: ['builtin:expo_push'] };
    const context = { surface: 'agent' as const, actionRequestId: 'notification-workflow-replay-1',
      actionCaller: { kind: 'workflowRun' as const, runId, authorization: {
        principal: { kind: 'host' as const }, admittedPermissionCeiling: 'read-only' as const,
      } } };
    await expect(executor.execute('notifications.notify_me', input, context))
      .resolves.toEqual({ ok: true, result: { attemptedChannels: 1, deliveredChannels: 1 } });
    await expect(executor.execute('notifications.notify_me', input, context))
      .resolves.toEqual({ ok: true, result: { attemptedChannels: 0, deliveredChannels: 0 } });
    expect(boundary.send.mock.calls[0]?.[0]).toMatchObject([{ title: 'Review', body: 'Panel finished', data: { runId } }]);
    expect(boundary.send).toHaveBeenCalledTimes(1);
  });

  it('lists configured channels and ignores a channel removed since authoring', async () => {
    const deps = host(accountSettingsParse({ notificationChannelsV1: [
      { kind: 'webhook', id: 'webhook:deploy', url: 'https://example.test/notify' },
    ] }));
    await expect(deps.notificationChannelsList?.({ surface: 'cli' })).resolves.toEqual({ items: [
      { value: 'builtin:expo_push', label: 'Push notifications' },
      { value: 'webhook:deploy', label: 'webhook:deploy' },
    ] });
    await expect(deps.notificationsNotifyMe?.({ message: 'ready', channels: ['removed'] }, { surface: 'cli' })).resolves.toEqual({ attemptedChannels: 0, deliveredChannels: 0 });
    expect(boundary.send).not.toHaveBeenCalled();
  });

  it('refuses an inaccessible session link before sending any notification', async () => {
    boundary.get.mockResolvedValue({ status: 404, data: { error: 'session_not_found' } });
    await expect(host().notificationsNotifyMe?.({ message: 'ready', open: { kind: 'session', sessionId: 'invisible-session' } },
      { surface: 'cli' })).resolves.toMatchObject({ ok: false, errorCode: 'session_not_found' });
    expect(boundary.send).not.toHaveBeenCalled();
  });

  it('reaches delivery and channel options through the canonical machine RPC registrar', async () => {
    const manager = new RpcHandlerManager({ scopePrefix: 'notification-machine', encryptionMode: 'plain' });
    registerMachineRpcHandlers({ rpcHandlerManager: manager,
      handlers: { spawnSession: async () => ({ type: 'error', errorCode: 'UNEXPECTED', errorMessage: 'unused' }),
        stopSession: async () => true, requestShutdown: () => {} },
      deps: { currentMachineId: 'notification-machine', externalAction: {
        machineId: 'notification-machine', currentServerId: 'notification-home',
        resolveAccountId: async () => 'notification-account',
        resolveTarget: async () => ({ kind: 'machine', machineId: 'notification-machine' }),
        executor: createActionExecutor(host()),
      } },
    });
    await expect(manager.invokeLocal('notifications.notify_me', { message: 'RPC ready', title: 'Ready', channels: ['builtin:expo_push'] }))
      .resolves.toEqual({ attemptedChannels: 1, deliveredChannels: 1 });
    await expect(manager.invokeLocal('action.options.resolve', { actionId: 'notifications.notify_me', fieldPath: 'channels' }))
      .resolves.toMatchObject({ options: [{ value: 'builtin:expo_push', label: 'Push notifications' }] });
    expect(boundary.send.mock.calls[0]?.[0]).toMatchObject([{ title: 'Ready', body: 'RPC ready' }]);
  });
});
