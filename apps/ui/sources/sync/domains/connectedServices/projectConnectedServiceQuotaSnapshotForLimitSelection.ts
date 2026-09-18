import {
    selectConnectedServiceQuotaMetersForLimitSelection,
    type ConnectedServiceQuotaLimitSelectionV1,
    type ConnectedServiceQuotaSnapshotV1,
    type QualifiedConnectedAccountQuotaSnapshotV4,
} from '@happier-dev/protocol';

type QuotaSnapshot = ConnectedServiceQuotaSnapshotV1 | QualifiedConnectedAccountQuotaSnapshotV4;

/**
 * Projects quota meters through a Pool policy while preserving subscription,
 * account, reset-credit, freshness, and identity facts from the source snapshot.
 */
export function projectConnectedServiceQuotaSnapshotForLimitSelection<T extends QuotaSnapshot>(
    snapshot: T | null,
    selection?: ConnectedServiceQuotaLimitSelectionV1,
): T | null {
    if (!snapshot || !selection || selection.mode === 'all') return snapshot;
    return {
        ...snapshot,
        meters: [...selectConnectedServiceQuotaMetersForLimitSelection(snapshot.meters, selection)],
    };
}
