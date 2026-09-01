import type {
    AccountDirectoryHomeAdoptionTarget,
    AccountDirectorySession,
    AccountDirectorySessionSnapshot,
} from '@/sync/domains/accountDirectory/accountDirectorySession';
import { adoptDirectoryHome } from './adoptDirectoryHome';

type AccountDirectoryRefreshOptions = Readonly<{
    shouldCancel?: () => boolean;
}>;

/** Refreshes advisory directory metadata and adopts returned Homes without changing focus/groups. */
export async function refreshAccountHomeDirectory(
    session: AccountDirectorySession,
    options: AccountDirectoryRefreshOptions = {},
): Promise<AccountDirectorySessionSnapshot> {
    const adopted: AccountDirectoryHomeAdoptionTarget[] = [];
    const failures: Array<AccountDirectoryHomeAdoptionTarget & Readonly<{ error: unknown }>> = [];
    if (options.shouldCancel?.()) {
        return session.recordReconciliation({ kind: 'cancelled', adopted, failures });
    }
    const snapshot = await session.refresh();
    if (snapshot.status !== 'ready') {
        return session.recordReconciliation({
            kind: 'snapshot_unavailable',
            snapshotStatus: snapshot.status,
            error: snapshot.error,
        });
    }
    if (options.shouldCancel?.()) {
        return session.recordReconciliation({ kind: 'cancelled', adopted, failures });
    }
    for (const entry of snapshot.homes) {
        if (options.shouldCancel?.()) {
            return session.recordReconciliation({ kind: 'cancelled', adopted, failures });
        }
        const target = {
            homeServerIdentityId: entry.homeServerIdentityId,
            label: entry.label,
        };
        try {
            await adoptDirectoryHome(entry);
            adopted.push(target);
        } catch (error) {
            failures.push({ ...target, error });
        }
    }
    return session.recordReconciliation({ kind: 'completed', adopted, failures });
}
