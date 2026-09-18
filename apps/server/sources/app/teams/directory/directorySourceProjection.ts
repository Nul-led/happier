import type {
    TeamDirectorySafeErrorCodeV1,
    TeamDirectorySourceAllowedActionV1,
    TeamDirectorySourceSummaryV1,
} from "@happier-dev/protocol/teams";

export const WORKOS_DIRECTORY_SYNC_TARGET_MS = 5 * 60 * 1_000;
export const GITHUB_DIRECTORY_SYNC_TARGET_MS = 30 * 60 * 1_000;
export const DIRECTORY_FULL_RECONCILE_TARGET_MS = 24 * 60 * 60 * 1_000;
export const DIRECTORY_EXTERNAL_REQUEST_TIMEOUT_MS = 30_000;

type DirectorySourceProjectionRow = Readonly<{
    id: string;
    teamId: string;
    kind: "workos_directory" | "github_organization";
    state: "initializing" | "active" | "paused" | "needs_attention";
    displayName: string;
    teamIdentityConnectionId?: string | null;
    activeReconcileRunId: string | null;
    activeReconcileStartedAt: Date | null;
    lastAttemptAt: Date | null;
    lastSuccessAt: Date | null;
    lastFullReconcileAt: Date | null;
    lastErrorCode: string | null;
    consecutiveFailureCount?: number;
    retryNotBefore?: Date | null;
}>;

const DIRECTORY_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000] as const;

export function deriveDirectoryFailureSchedule(input: Readonly<{
    kind: DirectorySourceProjectionRow["kind"];
    consecutiveFailureCount: number;
    failedAt: Date;
    retryAfterMs?: number;
}>): Readonly<{ consecutiveFailureCount: number; retryNotBefore: Date }> {
    const consecutiveFailureCount = Math.min(
        Math.max(0, Math.trunc(input.consecutiveFailureCount)) + 1,
        DIRECTORY_RETRY_DELAYS_MS.length,
    );
    const fallbackDelay = DIRECTORY_RETRY_DELAYS_MS[consecutiveFailureCount - 1];
    const providerDelay = input.retryAfterMs !== undefined
        && Number.isSafeInteger(input.retryAfterMs)
        && input.retryAfterMs >= 0
        ? input.retryAfterMs
        : undefined;
    const delayMs = providerDelay
        ?? Math.min(fallbackDelay, readDirectorySyncTargetMs(input.kind));
    return {
        consecutiveFailureCount,
        retryNotBefore: new Date(input.failedAt.getTime() + delayMs),
    };
}

/**
 * Reads one response header from an upstream provider SDK error. Provider SDKs
 * expose response headers either as a plain record (Octokit) or as a
 * `Headers`/`AxiosHeaders`-style object with `get()` (WorkOS' fetch transport),
 * so every directory reader reads them through this one owner.
 */
export function readUpstreamResponseHeader(error: unknown, name: string): string | undefined {
    if (typeof error !== "object" || error === null || !("response" in error)) return undefined;
    const response = error.response;
    if (typeof response !== "object" || response === null || !("headers" in response)) return undefined;
    const headers = response.headers;
    if (typeof headers !== "object" || headers === null) return undefined;
    const getHeader = "get" in headers ? headers.get : undefined;
    // Untyped external SDK boundary: the accessor is narrowed to a callable
    // before use and its result is validated below like any record value.
    const raw = typeof getHeader === "function"
        ? (getHeader as (headerName: string) => unknown).call(headers, name)
        : name in headers
            ? (headers as Readonly<Record<string, unknown>>)[name]
            : undefined;
    if (typeof raw === "string") return raw;
    return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : undefined;
}

export function parseDirectoryRetryAfterMs(value: unknown, now: Date = new Date()): number | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    if (/^[0-9]+$/.test(normalized)) {
        const delay = Number(normalized) * 1_000;
        return Number.isSafeInteger(delay) ? delay : undefined;
    }
    const notBefore = Date.parse(normalized);
    if (!Number.isFinite(notBefore)) return undefined;
    const delay = Math.max(0, notBefore - now.getTime());
    return Number.isSafeInteger(delay) ? delay : undefined;
}

export const NON_RETRYABLE_DIRECTORY_ERRORS: ReadonlySet<TeamDirectorySafeErrorCodeV1> = new Set([
    "directory_source_not_found",
    "directory_source_removed",
    "directory_source_identity_mismatch",
    "directory_source_permission_lost",
    "directory_group_mapping_invalid",
    "directory_group_already_bound",
    "directory_sync_needs_attention",
]);

const DIRECTORY_ERROR_CODES: Readonly<Record<TeamDirectorySafeErrorCodeV1, true>> = {
    directory_sync_unavailable: true,
    directory_source_not_found: true,
    directory_source_removed: true,
    directory_source_identity_mismatch: true,
    directory_source_permission_lost: true,
    directory_cursor_expired: true,
    directory_event_invalid: true,
    directory_snapshot_incomplete: true,
    directory_sync_rate_limited: true,
    directory_group_mapping_invalid: true,
    directory_group_already_bound: true,
    directory_sync_needs_attention: true,
};

function toTimestamp(value: Date | null): string | null {
    return value?.toISOString() ?? null;
}

function readSafeError(value: string | null): TeamDirectorySafeErrorCodeV1 | null {
    return value !== null && Object.prototype.hasOwnProperty.call(DIRECTORY_ERROR_CODES, value)
        ? value as TeamDirectorySafeErrorCodeV1
        : null;
}

export function readDirectorySyncTargetMs(kind: DirectorySourceProjectionRow["kind"]): number {
    return kind === "workos_directory"
        ? WORKOS_DIRECTORY_SYNC_TARGET_MS
        : GITHUB_DIRECTORY_SYNC_TARGET_MS;
}

export function isDirectoryErrorRetryable(errorCode: string): boolean {
    const safeError = readSafeError(errorCode);
    return safeError !== null && !NON_RETRYABLE_DIRECTORY_ERRORS.has(safeError);
}

function projectAllowedActions(
    state: DirectorySourceProjectionRow["state"],
): readonly TeamDirectorySourceAllowedActionV1[] {
    if (state === "paused") {
        return ["teams.directory.sources.resume", "teams.directory.sources.remove"];
    }
    return [
        "teams.directory.sources.sync",
        "teams.directory.sources.pause",
        "teams.directory.sources.remove",
    ];
}

export function projectTeamDirectorySourceSummary(params: Readonly<{
    source: DirectorySourceProjectionRow;
    now?: Date;
}>): TeamDirectorySourceSummaryV1 {
    const now = params.now ?? new Date();
    const source = params.source;
    const safeError = readSafeError(source.lastErrorCode);
    const targetMs = readDirectorySyncTargetMs(source.kind);
    const activeRunWithinOperationWindow = source.activeReconcileRunId !== null
        && source.activeReconcileStartedAt !== null
        && now.getTime() - source.activeReconcileStartedAt.getTime() <= targetMs;

    const attempt = source.state === "paused"
        ? "paused" as const
        : activeRunWithinOperationWindow
            ? "syncing" as const
            : source.activeReconcileRunId !== null
                ? "failed" as const
            : safeError !== null
                ? "failed" as const
                : source.lastAttemptAt === null
                    ? "never" as const
                    : "succeeded" as const;

    const freshness = source.state === "paused"
        ? "unknown" as const
        : source.lastSuccessAt === null
            ? "never_synced" as const
            : now.getTime() - source.lastSuccessAt.getTime() >= targetMs * 2
                ? "stale" as const
                : "fresh" as const;

    // A recorded retryable failure already has one persisted worker schedule
    // (`retryNotBefore`); the projection reports that fact instead of deriving a
    // second, disagreeing delay. Paused sources have no scheduled work.
    let nextScheduledAt: Date | null = null;
    if (source.state !== "paused") {
        const pendingRetryAt = safeError !== null && !NON_RETRYABLE_DIRECTORY_ERRORS.has(safeError)
            ? source.retryNotBefore ?? null
            : null;
        if (pendingRetryAt !== null) {
            nextScheduledAt = pendingRetryAt;
        } else if (source.state === "active" && source.lastSuccessAt !== null) {
            const incrementalDueAt = new Date(source.lastSuccessAt.getTime() + targetMs);
            const fullDueAt = source.lastFullReconcileAt === null
                ? now
                : new Date(source.lastFullReconcileAt.getTime() + DIRECTORY_FULL_RECONCILE_TARGET_MS);
            nextScheduledAt = incrementalDueAt.getTime() <= fullDueAt.getTime()
                ? incrementalDueAt
                : fullDueAt;
        }
    }

    return {
        v: 1,
        id: source.id,
        teamId: source.teamId,
        kind: source.kind,
        displayName: source.displayName,
        workosAdminPortalConnectionId: source.kind === "workos_directory"
            ? source.teamIdentityConnectionId ?? null
            : null,
        state: source.state,
        allowedActions: [...projectAllowedActions(source.state)],
        sync: {
            mode: source.kind === "workos_directory" ? "events_and_full" : "full_only",
            attempt,
            freshness,
            lastAttemptAt: toTimestamp(source.lastAttemptAt),
            lastSuccessAt: toTimestamp(source.lastSuccessAt),
            lastFullReconcileAt: toTimestamp(source.lastFullReconcileAt),
            nextScheduledAt: toTimestamp(nextScheduledAt),
        },
        error: safeError === null
            ? null
            : { code: safeError, retryable: !NON_RETRYABLE_DIRECTORY_ERRORS.has(safeError) },
    };
}
