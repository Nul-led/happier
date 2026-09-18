import type { ManagedIdentityProviderActionResult } from './managedIdentityProviderClient';

type RemovalBlockers = Readonly<{
    identityCount: number;
    connectionCount: number;
    affectedAccountIds: readonly string[];
}>;

type RemovalPreflight = Readonly<{
    provider: Readonly<{ id: string; revision: number }>;
    canRemove: boolean;
    blockers: RemovalBlockers;
}>;

export type ManagedIdentityProviderRemovalOutcome =
    | Readonly<{ kind: 'removed' }>
    | Readonly<{ kind: 'approval_pending'; artifactId: string }>
    | Readonly<{ kind: 'cancelled' }>
    | Readonly<{ kind: 'blocked'; blockers: RemovalBlockers }>
    | Readonly<{ kind: 'failed'; code: string }>;

export async function runManagedIdentityProviderRemoval(params: Readonly<{
    providerId: string;
    readPreflight: () => Promise<ManagedIdentityProviderActionResult<RemovalPreflight>>;
    confirm: (preflight: RemovalPreflight) => Promise<boolean>;
    remove: (expectedRevision: number) => Promise<ManagedIdentityProviderActionResult<Readonly<{ outcome: 'removed' }>>>;
}>): Promise<ManagedIdentityProviderRemovalOutcome> {
    const preflight = await params.readPreflight();
    if (preflight.kind === 'failed') return { kind: 'failed', code: preflight.failure.code };
    if (preflight.kind === 'approval_pending') return { kind: 'failed', code: 'invalid_action_output' };
    if (preflight.value.provider.id !== params.providerId) {
        return { kind: 'failed', code: 'identity_provider_revision_conflict' };
    }
    if (!preflight.value.canRemove) {
        return { kind: 'blocked', blockers: preflight.value.blockers };
    }
    if (!await params.confirm(preflight.value)) return { kind: 'cancelled' };
    const removed = await params.remove(preflight.value.provider.revision);
    if (removed.kind === 'approval_pending') return removed;
    return removed.kind === 'succeeded' ? { kind: 'removed' } : { kind: 'failed', code: removed.failure.code };
}
