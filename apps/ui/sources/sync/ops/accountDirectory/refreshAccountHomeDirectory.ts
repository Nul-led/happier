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
    const isCurrent = session.captureLifecycle();
    const shouldCancel = () => !isCurrent() || options.shouldCancel?.() === true;
    if (shouldCancel()) {
        return session.recordReconciliation({ kind: 'cancelled', adopted: [], failures: [] });
    }
    const snapshot = await session.refresh();
    // `refresh()` itself rejects late publication, but logout also resets the
    // session snapshot while the request is in flight. Do not decorate that
    // newer reset state with reconciliation owned by the superseded lifecycle.
    if (!isCurrent()) return session.snapshot;
    if (snapshot.status !== 'ready') {
        return session.recordReconciliation({
            kind: 'snapshot_unavailable',
            snapshotStatus: snapshot.status,
            error: snapshot.error,
        });
    }
    if (shouldCancel()) {
        return session.recordReconciliation({ kind: 'cancelled', adopted: [], failures: [] });
    }
    const reconciliation = await adoptAccountServiceDirectoryHomes({
        homes: snapshot.homes,
        adoptHome: adoptDirectoryHome,
        shouldCancel,
    });
    if (!isCurrent()) return session.snapshot;
    return session.recordReconciliation(reconciliation);
}
