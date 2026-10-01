import type { StoredCredentials } from '@/persistence';
import { bootstrapAccountSettingsContext } from '@/settings/accountSettings/bootstrapAccountSettingsContext';
import { initializeTerminalPresentUserPolicy } from '@/settings/accountSettings/resolveEffectiveTerminalPresentUserPolicy';

export async function ensureCliActionPolicySettings(credentials: StoredCredentials | null | undefined, serverHttpBaseUrl?: string): Promise<void> {
  if (!credentials) return;
  await initializeTerminalPresentUserPolicy({ token: credentials.token, ...(serverHttpBaseUrl ? { serverHttpBaseUrl } : {}) });
  await bootstrapAccountSettingsContext({
    credentials,
    // Policy is an admission input: a successful first fetch must publish before
    // prepare/execute can continue. Blocking bootstrap still falls back to the
    // existing cache/default contract when the settings service is unavailable.
    mode: 'blocking',
  });
}
