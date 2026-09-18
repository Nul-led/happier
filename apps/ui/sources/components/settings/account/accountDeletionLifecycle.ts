import type { AuthCredentialLifecycleResult } from '@/auth/context/AuthContext';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { removeRunnerCreatorCustodyForAccount } from '@/sync/domains/ephemeralRunner/runnerCreatorDraftRemoval';

export class AccountDeletedLocalCleanupError extends Error {
    readonly retryLocalCleanup: () => Promise<AuthCredentialLifecycleResult>;

    constructor(
        retryLocalCleanup: () => Promise<AuthCredentialLifecycleResult>,
        options?: ErrorOptions,
    ) {
        super('account_deleted_local_cleanup_failed', options);
        this.name = 'AccountDeletedLocalCleanupError';
        this.retryLocalCleanup = retryLocalCleanup;
    }
}

export async function completeAccountDeletion(params: Readonly<{
    scope: ServerAccountScope;
    deleteCurrentAccount(): Promise<Readonly<{ status: 'deleted' }>>;
    logout(options?: Readonly<{ beforeMutation?: () => void | Promise<void> }>): Promise<AuthCredentialLifecycleResult>;
    replace(path: '/'): void;
}>): Promise<AuthCredentialLifecycleResult> {
    let confirmed = false;
    const attempt = async (deleteRemotely: boolean): Promise<AuthCredentialLifecycleResult> => {
        try {
            return await params.logout({
                beforeMutation: async () => {
                    if (deleteRemotely) {
                        await params.deleteCurrentAccount();
                        confirmed = true;
                    }
                    await removeRunnerCreatorCustodyForAccount(params.scope);
                    params.replace('/');
                },
            });
        } catch (cause) {
            if (confirmed) throw new AccountDeletedLocalCleanupError(() => attempt(false), { cause });
            throw cause;
        }
    };
    return await attempt(true);
}
