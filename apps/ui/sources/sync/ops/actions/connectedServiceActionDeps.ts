import type { ActionExecutorDeps } from '@happier-dev/protocol';
import { executeConnectedServiceConfigurationActionV1 } from '@happier-dev/protocol/connect/execute-configuration-action';
import { throwConnectedServiceApiError } from '@/sync/api/account/connectedServiceApiError';
import { invalidateConnectedServiceGroupsRefreshSignal } from '@/sync/domains/connectedServices/connectedServiceGroupsRefreshSignal';
import type { LazyActionAccountContext } from './actionAccountContext';

export function createUiConnectedServiceAction(account: LazyActionAccountContext): NonNullable<ActionExecutorDeps['connectedServiceAction']> {
    return async ({ actionId, input, signal }) => {
        const localSettings = actionId === 'connectedServices.identityPrivacy.set'
            ? (await import('@/sync/domains/state/storageStore')).storage : null;
        return await executeConnectedServiceConfigurationActionV1({
            assertCurrent: () => { signal?.throwIfAborted(); account.assertCurrent(); },
            request: async ({ path, method, body }) => {
                const response = await account.request(path, {
                    method,
                    headers: { Authorization: `Bearer ${account.credentials.token}`, 'Content-Type': 'application/json' },
                    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                    ...(signal ? { signal } : {}),
                }, { includeAuth: false });
                if (!response.ok) await throwConnectedServiceApiError(response);
                const result: unknown = await response.json();
                account.assertCurrent();
                // Publish every acknowledged patch, including a prefix of a reorder that later fails.
                if (method !== 'GET') invalidateConnectedServiceGroupsRefreshSignal();
                return result;
            },
            mutateSettings: account.mutateRawSettings,
            resolveAgent: async (agentId, machineId) => {
                const [{ AGENT_IDS }, { getResolvedAgentCatalogEntries }, { loadDaemonMergedProjectionInputs }] = await Promise.all([
                    import('@/agents/catalog/catalog'),
                    import('@/agents/backendCatalog/agentCatalogProjection'),
                    import('@/agents/backendCatalog/loadDaemonMergedProjectionInputs'),
                ]);
                // Catalog provenance is selected explicitly, never borrowed from the focused Home.
                const projection = await loadDaemonMergedProjectionInputs({ machineId, serverId: account.serverId, accountLifetime: account.accountLifetime });
                if (!projection) return null;
                return getResolvedAgentCatalogEntries({ enabledAgentIds: AGENT_IDS, ...projection }).find((agent) => agent.agentId === agentId) ?? null;
            },
            resetQuota: async (args) => {
                const { connectedServiceQuotaRecoveryCreditConsume } = await import('@/sync/ops/connectedServiceQuotaRecoveryCredits');
                return await connectedServiceQuotaRecoveryCreditConsume({ ...args, serverId: account.serverId });
            },
            ...(localSettings ? { setIdentityPrivacy: (hidden: boolean) => localSettings.getState().applyLocalSettings({ hideConnectedAccountIdentities: hidden }, { source: 'ui' }) } : {}),
        }, actionId, input);
    };
}
