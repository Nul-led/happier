import { describe, expect, it } from 'vitest';
import { normalizeActionsSettingsV1 } from '@happier-dev/protocol';

import { createScopedRuntimeActionSettingsProvider } from './scopedRuntimeActionSettingsProvider';
import { createCliActionExecutor } from '@/session/actions/createCliActionExecutor';

describe('createScopedRuntimeActionSettingsProvider', () => {
  it('uses only the reviewed runtime policy and exposes no Account settings', () => {
    const previous = process.env.HAPPIER_ACTIONS_SETTINGS_V1;
    process.env.HAPPIER_ACTIONS_SETTINGS_V1 = JSON.stringify({
      v: 1,
      actions: { 'session.archives.delete': { enabled: true, requireConfirmation: false } },
    });
    try {
      const provider = createScopedRuntimeActionSettingsProvider({ v: 1, actions: {} });
      expect(provider.getActionsSettings()).toEqual({ v: 1, actions: {} });
      expect(provider.getAccountSettings).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.HAPPIER_ACTIONS_SETTINGS_V1;
      else process.env.HAPPIER_ACTIONS_SETTINGS_V1 = previous;
    }
  });

  it('retains the reviewed snapshot when the creator-side object is later mutated', () => {
    const reviewed = normalizeActionsSettingsV1({
      v: 1,
      actions: { 'session.activity.get': { enabled: true } },
    });
    const provider = createScopedRuntimeActionSettingsProvider(reviewed);

    reviewed.actions['session.activity.get'].enabled = false;

    expect(provider.getActionsSettings().actions['session.activity.get']?.enabled).toBe(true);

    const consumerSnapshot = provider.getActionsSettings();
    consumerSnapshot.actions['session.activity.get']!.enabled = false;
    expect(provider.getActionsSettings().actions['session.activity.get']?.enabled).toBe(true);
  });

  it('enforces the reviewed policy at the shared executor without trusting requested-by metadata', async () => {
    const allowedProvider = createScopedRuntimeActionSettingsProvider({ v: 1, actions: {} });
    const allowedExecutor = createCliActionExecutor({
      token: 'restricted-runtime-token',
      sessionId: 'runner-session',
      mode: 'plain',
      ctx: null,
      pluginActionExecutionOwner: 'current_process',
      actionsSettingsProvider: allowedProvider,
    });
    const spoofedRequestedByContext = Object.assign({
      surface: 'agent' as const,
      authority: 'account_automation' as const,
      defaultSessionId: 'runner-session',
    }, {
      // Authenticated authorship is provenance only and is not consulted by
      // the shared execution-authority owner.
      requestedBy: { accountId: 'collaborator-bob' },
    });
    await expect(allowedExecutor.execute(
      'action.spec.get',
      { id: 'session.activity.get' },
      spoofedRequestedByContext,
    )).resolves.toMatchObject({ ok: true });

    const disabledProvider = createScopedRuntimeActionSettingsProvider(normalizeActionsSettingsV1({
      v: 1,
      actions: { 'action.spec.get': { enabled: false } },
    }));
    const disabledExecutor = createCliActionExecutor({
      token: 'restricted-runtime-token',
      sessionId: 'runner-session',
      mode: 'plain',
      ctx: null,
      pluginActionExecutionOwner: 'current_process',
      actionsSettingsProvider: disabledProvider,
    });
    await expect(disabledExecutor.execute('action.spec.get', { id: 'session.activity.get' }, {
      surface: 'agent', authority: 'account_automation', defaultSessionId: 'runner-session',
    })).resolves.toMatchObject({ ok: false, errorCode: 'action_disabled' });
  });

  it('fails confirmation-required Runner Actions closed when scoped confirmation custody is unavailable', async () => {
    const provider = createScopedRuntimeActionSettingsProvider(normalizeActionsSettingsV1({
      v: 1,
      actions: { 'session.activity.get': { approvalRequiredSurfaces: ['agent'] } },
    }));
    const executor = createCliActionExecutor({
      token: 'restricted-runtime-token',
      sessionId: 'runner-session',
      mode: 'plain',
      ctx: null,
      pluginActionExecutionOwner: 'current_process',
      actionsSettingsProvider: provider,
    });
    await expect(executor.execute('session.activity.get', { sessionId: 'runner-session' }, {
      surface: 'agent', authority: 'account_automation', defaultSessionId: 'runner-session',
    })).resolves.toMatchObject({ ok: false, errorCode: 'approvals_not_supported' });
  });
});
