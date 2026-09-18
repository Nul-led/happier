import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountSettingsParse, normalizeActionsSettingsV1 } from '@happier-dev/protocol';

import { resetInMemoryAccountSettingsContextForTests } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import { getActiveAccountSettingsSnapshot, setActiveAccountSettingsSnapshot } from '@/settings/accountSettings/activeAccountSettingsSnapshot';
import { resolveAccountSettingsScopeKey } from '@/settings/accountSettings/accountSettingsScopeKey';
import { createCliActionExecutorFromCredentials } from './createCliActionExecutorFromCredentials';

const axiosGet = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: { get: axiosGet },
}));

afterEach(() => {
  resetInMemoryAccountSettingsContextForTests();
  axiosGet.mockReset();
  vi.unstubAllEnvs();
});

describe('credentialed Action policy binding before settings bootstrap', () => {
  it.each(['execute', 'prepare'] as const)(
    'uses an explicit reviewed policy for %s without bootstrapping ambient Account settings',
    async (method) => {
      vi.stubEnv('HAPPIER_ACCOUNT_SETTINGS_MODE', 'auto');
      const executor = createCliActionExecutorFromCredentials({
        credentials: {
          token: `scoped-reviewed-policy-${method}`,
          encryption: null,
          credentialProvenance: 'stored_session',
        },
        actionsSettingsProvider: {
          getActionsSettings: () => normalizeActionsSettingsV1({
            v: 1,
            actions: { 'action.spec.get': { enabled: false } },
          }),
        },
        pluginActionExecutionOwner: 'current_process',
      });

      const result = method === 'execute'
        ? await executor.execute('action.spec.get', { id: 'session.list' }, { surface: 'cli' })
        : await executor.prepare('action.spec.get', { id: 'session.list' }, { surface: 'cli' });

      expect(result).toMatchObject(method === 'execute'
        ? { ok: false, errorCode: 'action_disabled' }
        : { kind: 'settled', result: { ok: false, errorCode: 'action_disabled' } });
      expect(axiosGet).not.toHaveBeenCalled();
    },
  );

  it.each([
    { initial: 'empty', kind: 'fixed', method: 'execute' },
    { initial: 'other_account', kind: 'fixed', method: 'prepare' },
    { initial: 'empty', kind: 'refreshing', method: 'execute' },
    { initial: 'other_account', kind: 'refreshing', method: 'prepare' },
  ] as const)('awaits $kind credential policy before $method with an initially $initial snapshot', async ({ initial, kind, method }) => {
    vi.stubEnv('HAPPIER_ACTIONS_SETTINGS_V1', '');
    vi.stubEnv('HAPPIER_ACCOUNT_SETTINGS_MODE', 'auto');
    resetInMemoryAccountSettingsContextForTests();
    const credentials = {
      token: `alice-policy-token-${kind}-${method}-${initial}`,
      encryption: null,
      credentialProvenance: 'stored_session' as const,
    };
    if (initial === 'other_account') {
      setActiveAccountSettingsSnapshot({ scopeKey: 'bob', source: 'network', loadedAtMs: Date.now(),
        settingsVersion: 1, settingsSecretsReadKeys: [], settings: accountSettingsParse({}) });
    }
    let resolvePolicyRequest!: (response: unknown) => void;
    axiosGet.mockReturnValueOnce(new Promise((resolve) => {
      resolvePolicyRequest = resolve;
    }));
    const executor = createCliActionExecutorFromCredentials({
      credentials,
      ...(kind === 'refreshing' ? { readCredentials: async () => credentials } : {}),
      pluginActionExecutionOwner: 'current_process',
    });

    const pending = method === 'execute'
      ? executor.execute('action.spec.get', { id: 'session.list' }, { surface: 'cli' })
      : executor.prepare('action.spec.get', { id: 'session.list' }, { surface: 'cli' });
    await vi.waitFor(() => expect(axiosGet).toHaveBeenCalledTimes(1));
    let settled = false;
    void pending.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolvePolicyRequest({ status: 200, data: { version: 2, content: { t: 'plain', v: {
      actionsSettingsV1: { v: 1, actions: { 'action.spec.get': { enabled: false } } },
    } } } });
    await vi.waitFor(() => expect(getActiveAccountSettingsSnapshot()).toMatchObject({
      scopeKey: resolveAccountSettingsScopeKey(credentials),
      settingsVersion: 2,
      settings: { actionsSettingsV1: { actions: { 'action.spec.get': { enabled: false } } } },
    }));
    await expect(pending).resolves.toMatchObject(method === 'execute'
      ? { ok: false, errorCode: 'action_disabled' }
      : { kind: 'settled', result: { ok: false, errorCode: 'action_disabled' } });
  });
});
