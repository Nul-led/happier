import { describe, expect, it, vi } from 'vitest';

import { decideMachinePluginInstallReviewAsPresentUser } from './machinePluginInstallPresentUserDecision.mjs';

describe('decideMachinePluginInstallReviewAsPresentUser', () => {
    it('sends the affirmative decision only after confirmation and a current-authority recheck', async () => {
        const order: string[] = [];
        const callAuthenticatedPrivateRpc = vi.fn(async (_method: string, _payload: unknown) => {
            order.push('send');
            return { kind: 'committed', pluginId: 'acme.plugin' };
        });

        await expect(decideMachinePluginInstallReviewAsPresentUser({
            pendingChangeId: 'pending-1',
            confirmPresentUser: async () => {
                order.push('confirm');
                return [{ accessId: 'workspace', selected: false }];
            },
            isAuthorityCurrent: () => {
                order.push('authority');
                return true;
            },
            callAuthenticatedPrivateRpc,
        })).resolves.toEqual({ kind: 'committed', pluginId: 'acme.plugin' });

        expect(order).toEqual(['confirm', 'authority', 'send']);
        // The decision names the pending change and the user's selections only.
        // Who decided is established by the authenticated RPC, and when it was
        // approved is stamped by the daemon, so neither travels in the payload.
        expect(callAuthenticatedPrivateRpc).toHaveBeenCalledWith(
            'daemon.plugins.install.review.decide',
            {
                v: 1,
                pendingChangeId: 'pending-1',
                decision: 'installAndTrust',
                optionalSelections: [{ accessId: 'workspace', selected: false }],
            },
        );
    });

    it('does not send when authority changes during confirmation', async () => {
        const callAuthenticatedPrivateRpc = vi.fn();

        await expect(decideMachinePluginInstallReviewAsPresentUser({
            pendingChangeId: 'pending-1',
            confirmPresentUser: async () => [],
            isAuthorityCurrent: () => false,
            callAuthenticatedPrivateRpc,
        })).rejects.toThrow('authority changed');

        expect(callAuthenticatedPrivateRpc).not.toHaveBeenCalled();
    });

    it('turns declined confirmation into private cancellation', async () => {
        const callAuthenticatedPrivateRpc = vi.fn(async () => ({ kind: 'cancelled' }));

        await expect(decideMachinePluginInstallReviewAsPresentUser({
            pendingChangeId: 'pending-1',
            confirmPresentUser: async () => null,
            isAuthorityCurrent: () => true,
            callAuthenticatedPrivateRpc,
        })).resolves.toEqual({ kind: 'cancelled' });

        expect(callAuthenticatedPrivateRpc).toHaveBeenCalledWith(
            'daemon.plugins.install.review.decide',
            {
                v: 1,
                pendingChangeId: 'pending-1',
                decision: 'cancel',
            },
        );
    });
});
