import type {
    TeamDirectorySourceRemovalPreflightV1,
    TeamDirectorySourceRemoveResultV1,
} from '@happier-dev/protocol/teams';

import type { IdentityAdministrationActionResult } from './identityAdministrationClient';

export type DirectorySourceRemovalOutcome =
    | Readonly<{ kind: 'removed' }>
    | Readonly<{ kind: 'approval_pending' }>
    | Readonly<{ kind: 'cancelled' }>
    | Readonly<{ kind: 'failed'; code: string }>;

/**
 * Keeps the human impact review coupled to the exact source it describes.
 * The fresh read remains explanatory only: the remove mutation still performs
 * the server's current permission and source-state checks.
 */
export async function runDirectorySourceRemoval(params: Readonly<{
    sourceId: string;
    readImpact: () => Promise<IdentityAdministrationActionResult<TeamDirectorySourceRemovalPreflightV1>>;
    confirm: (impact: TeamDirectorySourceRemovalPreflightV1) => Promise<boolean>;
    remove: (options?: Readonly<{
        onApprovalSucceeded?: (value: TeamDirectorySourceRemoveResultV1) => void | Promise<void>;
        onApprovalFailed?: (code: string) => void;
    }>) => Promise<IdentityAdministrationActionResult<TeamDirectorySourceRemoveResultV1>>;
    onApprovalSucceeded?: (value: TeamDirectorySourceRemoveResultV1) => void | Promise<void>;
    onApprovalFailed?: (code: string) => void;
}>): Promise<DirectorySourceRemovalOutcome> {
    const preflight = await params.readImpact();
    if (!preflight.ok) return { kind: 'failed', code: preflight.failure.code };
    if (preflight.value.sourceId !== params.sourceId) {
        return { kind: 'failed', code: 'directory_source_changed' };
    }
    if (!await params.confirm(preflight.value)) return { kind: 'cancelled' };
    const removed = await params.remove({
        ...(params.onApprovalSucceeded ? { onApprovalSucceeded: params.onApprovalSucceeded } : {}),
        ...(params.onApprovalFailed ? { onApprovalFailed: params.onApprovalFailed } : {}),
    });
    if (!removed.ok && 'approvalPending' in removed) return { kind: 'approval_pending' };
    return removed.ok
        ? { kind: 'removed' }
        : { kind: 'failed', code: removed.failure.code };
}
