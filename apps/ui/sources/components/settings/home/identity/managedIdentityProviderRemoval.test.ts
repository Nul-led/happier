import { describe, expect, it, vi } from 'vitest';

import { runManagedIdentityProviderRemoval } from './managedIdentityProviderRemoval';

describe('runManagedIdentityProviderRemoval', () => {
    const approval = { artifactId: 'approval-1', onExecuted: async () => 'consumed' as const };
    const readApproval = { artifactId: 'approval-read', onExecuted: async () => 'consumed' as const };
    const preflight = {
        provider: { id: 'provider-1', revision: 4 },
        canRemove: true,
        blockers: { identityCount: 0, connectionCount: 0, affectedAccountIds: [] },
    };

    it('does not mutate after a cancelled fresh impact review', async () => {
        const remove = vi.fn();
        const result = await runManagedIdentityProviderRemoval({
            providerId: 'provider-1',
            readPreflight: async () => ({ kind: 'succeeded', value: preflight }),
            confirm: async () => false,
            remove,
        });
        expect(result).toEqual({ kind: 'cancelled' });
        expect(remove).not.toHaveBeenCalled();
    });

    it('reports blockers without offering confirmation or mutation', async () => {
        const confirm = vi.fn();
        const remove = vi.fn();
        const blocked = { ...preflight, canRemove: false, blockers: { identityCount: 2, connectionCount: 1, affectedAccountIds: ['account-1'] } };
        const result = await runManagedIdentityProviderRemoval({
            providerId: 'provider-1',
            readPreflight: async () => ({ kind: 'succeeded', value: blocked }),
            confirm,
            remove,
        });
        expect(result).toEqual({ kind: 'blocked', blockers: blocked.blockers });
        expect(confirm).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it('awaits a read-only preflight approval before confirmation', async () => {
        const confirm = vi.fn(async () => true);
        const remove = vi.fn();
        const result = await runManagedIdentityProviderRemoval({
            providerId: 'provider-1',
            readPreflight: async (options) => {
                await options?.onApprovalSucceeded?.(preflight);
                return { kind: 'approval_pending', artifactId: readApproval.artifactId, approval: readApproval };
            },
            confirm,
            remove: async () => ({ kind: 'succeeded' as const, value: { outcome: 'removed' as const } }),
        });

        expect(result).toEqual({ kind: 'removed' });
        expect(confirm).toHaveBeenCalledOnce();
    });

    it('uses the preflight revision for the confirmed mutation', async () => {
        const remove = vi.fn(async () => ({ kind: 'succeeded' as const, value: { outcome: 'removed' as const } }));
        const result = await runManagedIdentityProviderRemoval({
            providerId: 'provider-1',
            readPreflight: async () => ({ kind: 'succeeded', value: preflight }),
            confirm: async () => true,
            remove,
        });
        expect(result).toEqual({ kind: 'removed' });
        expect(remove).toHaveBeenCalledWith(4);
    });

    it('returns the pending approval without claiming the provider was removed', async () => {
        const result = await runManagedIdentityProviderRemoval({
            providerId: 'provider-1',
            readPreflight: async () => ({ kind: 'succeeded', value: preflight }),
            confirm: async () => true,
            remove: async () => ({ kind: 'approval_pending', artifactId: 'approval-1', approval }),
        });

        expect(result).toEqual({ kind: 'approval_pending', artifactId: 'approval-1', approval });
    });
});
