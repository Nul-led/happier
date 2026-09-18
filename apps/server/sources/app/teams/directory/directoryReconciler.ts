import type { ClaimedDirectorySource } from "./directorySourceService";
import type { ActiveWorkosDirectorySource } from "./directorySourceService";
import {
    markActiveWorkosDirectoryPollFailed,
    markDirectorySourceReconcileFailed,
    removeDirectorySourceForObservedDeletion,
} from "./directorySourceService";
import {
    commitActiveWorkosProjectionEvent,
    commitDirectoryProjectionPage,
    commitInitializingWorkosProjectionEvent,
    completeDirectoryProjection,
    completeActiveWorkosEmptyPoll,
    finalizeDirectoryProjection,
    stageInitializingWorkosGroupMemberEventPage,
    stageActiveWorkosGroupMemberEventPage,
    type InitializingWorkosGroupMemberEventPage,
    type InitializingWorkosProjectionEvent,
} from "./directoryProjectionRepository";
import type { DirectoryGroup, DirectoryGroupMember, DirectoryPerson } from "./directorySourceEvidence";

export type DirectoryProjectionScanFailureCode =
    | "directory_cursor_expired"
    | "directory_source_identity_mismatch"
    | "directory_source_permission_lost"
    | "directory_sync_rate_limited"
    | "directory_snapshot_incomplete"
    | "directory_sync_unavailable"
    | "stale_run";

export type DirectoryProjectionScanResult =
    | Readonly<{ ok: true; sourceDeleted?: false }>
    | Readonly<{ ok: true; sourceDeleted: true }>
    | Readonly<{
        ok: false;
        code: DirectoryProjectionScanFailureCode;
        retryAfterMs?: number;
        reconcileRunId?: string;
    }>;

export type DirectoryProjectionCatchUpResult =
    | DirectoryProjectionScanResult
    | Readonly<{ ok: true; sourceDeleted: true }>;

export type DirectoryProjectionScan = (params: Readonly<{
    source: ClaimedDirectorySource;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    writePeoplePage: (people: readonly DirectoryPerson[]) => Promise<boolean>;
    writeGroupsPage: (groups: readonly DirectoryGroup[]) => Promise<boolean>;
    writeGroupMembersPage: (members: readonly DirectoryGroupMember[]) => Promise<boolean>;
}>) => Promise<DirectoryProjectionScanResult>;

export type DirectoryProjectionCatchUp = (params: Readonly<{
    source: ClaimedDirectorySource | ActiveWorkosDirectorySource;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    writeWorkosEvent: (
        event: Omit<InitializingWorkosProjectionEvent, "sourceId" | "reconcileRunId">,
    ) => Promise<boolean>;
    stageWorkosGroupMembersEventPage: (
        page: Omit<InitializingWorkosGroupMemberEventPage, "sourceId" | "reconcileRunId">,
    ) => Promise<boolean>;
}>) => Promise<DirectoryProjectionCatchUpResult>;

export type DirectoryProjectionReconcileResult =
    | Readonly<{ status: "completed" }>
    | Readonly<{ status: "stale" }>
    | Readonly<{ status: "failed"; code: Exclude<DirectoryProjectionScanFailureCode, "stale_run"> }>;

export async function runActiveWorkosDirectoryIncremental(params: Readonly<{
    source: ActiveWorkosDirectorySource;
    catchUp: DirectoryProjectionCatchUp;
    signal?: AbortSignal;
    completedAt?: Date;
    beforeProjectionWrite?: () => Promise<boolean>;
}>): Promise<DirectoryProjectionReconcileResult> {
    let expectedPosition: InitializingWorkosProjectionEvent["expectedPosition"];
    if (params.source.eventCursor !== null) {
        expectedPosition = { eventCursor: params.source.eventCursor };
    } else if (params.source.eventRangeStart !== null) {
        expectedPosition = { eventCursor: null, eventRangeStart: params.source.eventRangeStart };
    } else {
        return { status: "failed", code: "directory_snapshot_incomplete" };
    }

    const result = await params.catchUp({
        source: params.source,
        signal: params.signal,
        writeWorkosEvent: async (event) => {
            if (params.signal?.aborted) return false;
            if (params.beforeProjectionWrite && !await params.beforeProjectionWrite()) return false;
            const committed = await commitActiveWorkosProjectionEvent({
                sourceId: params.source.id,
                ...event,
                completedAt: params.completedAt,
            });
            if (committed.applied) expectedPosition = { eventCursor: event.eventId };
            return committed.applied;
        },
        stageWorkosGroupMembersEventPage: async (page) => {
            if (params.signal?.aborted) return false;
            if (params.beforeProjectionWrite && !await params.beforeProjectionWrite()) return false;
            const staged = await stageActiveWorkosGroupMemberEventPage({
                sourceId: params.source.id,
                ...page,
            });
            return staged.applied;
        },
    });
    if (result.ok && result.sourceDeleted) {
        const removed = await removeDirectorySourceForObservedDeletion({
            teamId: params.source.teamId,
            sourceId: params.source.id,
            expectedState: "active",
            reconcileRunId: null,
            expectedPosition,
        });
        return removed.applied ? { status: "completed" } : { status: "stale" };
    }
    if (!result.ok) {
        if (result.code === "stale_run") return { status: "stale" };
        const failed = await markActiveWorkosDirectoryPollFailed({
            sourceId: params.source.id,
            expectedPosition,
            errorCode: result.code,
            consecutiveFailureCount: params.source.consecutiveFailureCount ?? 0,
            ...(result.reconcileRunId !== undefined ? { reconcileRunId: result.reconcileRunId } : {}),
            ...(result.retryAfterMs !== undefined ? { retryAfterMs: result.retryAfterMs } : {}),
        });
        return failed.applied ? { status: "failed", code: result.code } : { status: "stale" };
    }
    if (params.beforeProjectionWrite && !await params.beforeProjectionWrite()) return { status: "stale" };
    const completed = await completeActiveWorkosEmptyPoll({
        sourceId: params.source.id,
        expectedPosition,
        completedAt: params.completedAt,
    });
    return completed.applied ? { status: "completed" } : { status: "stale" };
}

/**
 * Reconcile one already-claimed source into the child-05 projection owner.
 * Provider calls remain outside transactions; every bounded page crosses the
 * repository's source/run CAS before it can become staged evidence.
 */
export async function runClaimedDirectoryProjectionReconcile(params: Readonly<{
    source: ClaimedDirectorySource;
    scan: DirectoryProjectionScan;
    catchUp?: DirectoryProjectionCatchUp;
    signal?: AbortSignal;
    completedAt?: Date;
    beforeProjectionWrite?: () => Promise<boolean>;
}>): Promise<DirectoryProjectionReconcileResult> {
    const writePage = async (page: Readonly<{
        people?: readonly DirectoryPerson[];
        groups?: readonly DirectoryGroup[];
        groupMembers?: readonly DirectoryGroupMember[];
    }>): Promise<boolean> => {
        if (params.signal?.aborted) return false;
        if (params.beforeProjectionWrite && !await params.beforeProjectionWrite()) return false;
        const result = await commitDirectoryProjectionPage({
            sourceId: params.source.id,
            reconcileRunId: params.source.reconcileRunId,
            ...page,
        });
        return result.applied;
    };

    const scanResult = await params.scan({
        source: params.source,
        signal: params.signal,
        writePeoplePage: (people) => writePage({ people }),
        writeGroupsPage: (groups) => writePage({ groups }),
        writeGroupMembersPage: (groupMembers) => writePage({ groupMembers }),
    });
    if (!scanResult.ok) {
        if (scanResult.code === "stale_run") return { status: "stale" };
        await markDirectorySourceReconcileFailed({
            sourceId: params.source.id,
            reconcileRunId: params.source.reconcileRunId,
            errorCode: scanResult.code,
            consecutiveFailureCount: params.source.consecutiveFailureCount ?? 0,
            ...(scanResult.retryAfterMs !== undefined ? { retryAfterMs: scanResult.retryAfterMs } : {}),
        });
        return { status: "failed", code: scanResult.code };
    }
    if (scanResult.sourceDeleted) {
        const expectedPosition: InitializingWorkosProjectionEvent["expectedPosition"] | null =
            params.source.eventCursor !== null
                ? { eventCursor: params.source.eventCursor }
                : params.source.eventRangeStart !== null
                    ? { eventCursor: null, eventRangeStart: params.source.eventRangeStart }
                    : null;
        if (!expectedPosition || params.source.kind !== "workos_directory") {
            await markDirectorySourceReconcileFailed({
                sourceId: params.source.id,
                reconcileRunId: params.source.reconcileRunId,
                errorCode: "directory_snapshot_incomplete",
                consecutiveFailureCount: params.source.consecutiveFailureCount ?? 0,
            });
            return { status: "failed", code: "directory_snapshot_incomplete" };
        }
        const removed = await removeDirectorySourceForObservedDeletion({
            teamId: params.source.teamId,
            sourceId: params.source.id,
            expectedState: "initializing",
            reconcileRunId: params.source.reconcileRunId,
            expectedPosition,
        });
        return removed.applied ? { status: "completed" } : { status: "stale" };
    }

    if (params.beforeProjectionWrite && !await params.beforeProjectionWrite()) return { status: "stale" };
    const finalized = await finalizeDirectoryProjection({
        sourceId: params.source.id,
        reconcileRunId: params.source.reconcileRunId,
    });
    if (!finalized.applied) return { status: "stale" };

    if (params.source.kind === "workos_directory") {
        let expectedPosition: InitializingWorkosProjectionEvent["expectedPosition"] | null =
            params.source.eventCursor !== null
                ? { eventCursor: params.source.eventCursor }
                : params.source.eventRangeStart !== null
                    ? { eventCursor: null, eventRangeStart: params.source.eventRangeStart }
                    : null;
        const catchUpResult = params.catchUp
            ? await params.catchUp({
                source: params.source,
                signal: params.signal,
                writeWorkosEvent: async (event) => {
                    if (params.signal?.aborted) return false;
                    if (params.beforeProjectionWrite && !await params.beforeProjectionWrite()) return false;
                    const result = await commitInitializingWorkosProjectionEvent({
                        sourceId: params.source.id,
                        reconcileRunId: params.source.reconcileRunId,
                        ...event,
                    });
                    if (result.applied) expectedPosition = { eventCursor: event.eventId };
                    return result.applied;
                },
                stageWorkosGroupMembersEventPage: async (page) => {
                    if (params.signal?.aborted) return false;
                    if (params.beforeProjectionWrite && !await params.beforeProjectionWrite()) return false;
                    const result = await stageInitializingWorkosGroupMemberEventPage({
                        sourceId: params.source.id,
                        reconcileRunId: params.source.reconcileRunId,
                        ...page,
                    });
                    return result.applied;
                },
            })
            : { ok: false as const, code: "directory_sync_unavailable" as const };
        if (!catchUpResult.ok) {
            if (catchUpResult.code === "stale_run") return { status: "stale" };
            await markDirectorySourceReconcileFailed({
                sourceId: params.source.id,
                reconcileRunId: params.source.reconcileRunId,
                errorCode: catchUpResult.code,
                consecutiveFailureCount: params.source.consecutiveFailureCount ?? 0,
                ...(catchUpResult.retryAfterMs !== undefined ? { retryAfterMs: catchUpResult.retryAfterMs } : {}),
            });
            return { status: "failed", code: catchUpResult.code };
        }
        if (catchUpResult.sourceDeleted) {
            if (!expectedPosition) {
                await markDirectorySourceReconcileFailed({
                    sourceId: params.source.id,
                    reconcileRunId: params.source.reconcileRunId,
                    errorCode: "directory_snapshot_incomplete",
                    consecutiveFailureCount: params.source.consecutiveFailureCount ?? 0,
                });
                return { status: "failed", code: "directory_snapshot_incomplete" };
            }
            const removed = await removeDirectorySourceForObservedDeletion({
                teamId: params.source.teamId,
                sourceId: params.source.id,
                expectedState: "initializing",
                reconcileRunId: params.source.reconcileRunId,
                expectedPosition,
            });
            return removed.applied ? { status: "completed" } : { status: "stale" };
        }
    }

    const completion = await completeDirectoryProjection({
        sourceId: params.source.id,
        reconcileRunId: params.source.reconcileRunId,
        observedManualSyncRequestedAt: params.source.observedManualSyncRequestedAt,
        completedAt: params.completedAt,
    });
    if (completion.applied) return { status: "completed" };
    return { status: "stale" };
}
