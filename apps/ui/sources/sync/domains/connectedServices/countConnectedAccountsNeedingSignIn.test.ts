import { describe, expect, it } from 'vitest';

import { countConnectedAccountsNeedingSignIn } from './countConnectedAccountsNeedingSignIn';

const v4 = (status: string) => ({ ref: { service: { pluginId: 'p', localId: 's' }, accountId: status }, status });

describe('countConnectedAccountsNeedingSignIn', () => {
    it('counts only accounts that need a new sign-in; low limits and retrying refreshes are not a "needs you"', () => {
        expect(countConnectedAccountsNeedingSignIn({
            connectedAccountsV4: [v4('needs_reauth'), v4('connected'), v4('refresh_failed_retryable'), v4('refreshing')],
            connectedServicesV2: [],
        })).toBe(1);
    });

    it('reads the released profile projection only when the account list is not there', () => {
        const legacy = [{ serviceId: 'anthropic', profiles: [{ profileId: 'a', status: 'needs_reauth' }, { profileId: 'b', status: 'connected' }] }];
        expect(countConnectedAccountsNeedingSignIn({ connectedAccountsV4: [], connectedServicesV2: legacy })).toBe(1);
        expect(countConnectedAccountsNeedingSignIn({ connectedAccountsV4: [v4('connected')], connectedServicesV2: legacy })).toBe(0);
    });
});
