import { describe, expect, it } from 'vitest';

import { getLegacyConnectedServiceRegistryEntry, type ConnectedServiceRegistryEntry } from './connectedServiceRegistry';
import { listConnectedAccountsNeedingSignIn } from './connectedAccountsNeedingSignIn';

const service = { pluginId: 'happier.example', localId: 'subscription' } as const;
const entry: ConnectedServiceRegistryEntry = {
    serviceId: 'example-subscription',
    service,
    connectCommand: 'happier connect example-subscription',
    supportsOauth: true,
} as ConnectedServiceRegistryEntry;

function v4Account(accountId: string, status: 'connected' | 'needs_reauth' | 'refresh_failed_retryable') {
    return { ref: { service, accountId }, status };
}

describe('listConnectedAccountsNeedingSignIn', () => {
    it('lists the qualified accounts whose credentials need signing in again, with their service', () => {
        const result = listConnectedAccountsNeedingSignIn({
            profile: {
                connectedServicesV2: [],
                connectedAccountsV4: [
                    v4Account('acct-ok', 'connected'),
                    v4Account('acct-expired', 'needs_reauth'),
                    v4Account('acct-retrying', 'refresh_failed_retryable'),
                ],
            },
            accountTransport: 'advertised-v4',
            entries: [entry],
        });
        expect(result.map((item) => ({ accountId: item.accountId, service: item.service, entry: item.entry }))).toEqual([
            { accountId: 'acct-expired', service, entry },
        ]);
    });

    it('reads the released per-service profiles on a legacy server', () => {
        const result = listConnectedAccountsNeedingSignIn({
            profile: {
                connectedServicesV2: [
                    { serviceId: 'openai-codex', profiles: [{ profileId: 'work', status: 'needs_reauth' }, { profileId: 'home', status: 'connected' }] },
                ],
                connectedAccountsV4: [v4Account('acct-expired', 'needs_reauth')],
            },
            accountTransport: 'legacy',
            entries: [entry],
        });
        const legacyEntry = getLegacyConnectedServiceRegistryEntry('openai-codex');
        expect(legacyEntry.service).toBeDefined();
        expect(result).toEqual([expect.objectContaining({ accountId: null, service: legacyEntry.service })]);
    });

    it('claims nothing while the server has not said which accounts it keeps', () => {
        expect(listConnectedAccountsNeedingSignIn({
            profile: { connectedServicesV2: [], connectedAccountsV4: [v4Account('acct-expired', 'needs_reauth')] },
            accountTransport: 'indeterminate',
            entries: [entry],
        })).toEqual([]);
    });
});
