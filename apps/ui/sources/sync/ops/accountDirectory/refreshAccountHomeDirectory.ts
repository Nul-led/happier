import type {
    AccountDirectorySession,
    AccountDirectorySessionSnapshot,
} from '@/sync/domains/accountDirectory/accountDirectorySession';
import { adoptAccountServiceDirectoryHomes } from '@happier-dev/cli-common/accountService';
import { adoptDirectoryHome } from './adoptDirectoryHome';

type AccountDirectoryRefreshOptions = Readonly<{
    shouldCancel?: () => boolean;
}>;

/** Refreshes advisory directory metadata and adopts returned Homes without changing focus/groups. */
export async function refreshAccountHomeDirectory(
    session: AccountDirectorySession,
    options: AccountDirectoryRefreshOptions = {},
): Promise<AccountDirectorySessionSnapshot> {
    if (options.shouldCancel?.()) {
        return session.recordReconciliation({ kind: 'cancelled', adopted: [], failures: [] });
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
        return session.recordReconciliation({ kind: 'cancelled', adopted: [], failures: [] });
    }
    const reconciliation = await adoptAccountServiceDirectoryHomes({
        homes: snapshot.homes,
        adoptHome: adoptDirectoryHome,
        shouldCancel: options.shouldCancel,
    });
    return session.recordReconciliation(reconciliation);
}
