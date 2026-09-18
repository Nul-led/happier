import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import { buildSnapshotSignature } from '@/scm/statusSync/projectState';

// Equal status/line counts do not establish equal file contents across refreshes.
export function buildScmDiffSnapshotSignature(snapshot: ScmWorkingSnapshot, shapeSignature = buildSnapshotSignature(snapshot)): string {
    return JSON.stringify([shapeSignature, snapshot.fetchedAt]);
}
