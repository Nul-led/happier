import { randomUUID } from "node:crypto";
import { db, isPrismaErrorCode } from "@/storage/db";
import { inTx, type Tx } from "@/storage/inTx";
import { parseTeamIdentityConnectionDocuments } from "@/app/auth/providers/managed/identityProviderDocuments";
import { resolveStoredGitHubDirectoryReadiness } from "@/app/integrations/github/githubManagedDirectory";
import { readHomeGovernancePolicyInTx } from "@/app/home/governance/governancePolicy";
import {
    deriveGithubDirectoryExternalSourceKey,
    deriveWorkosDirectoryExternalSourceKey,
    parseTeamDirectoryBindingConfigV1,
    type TeamDirectoryBindingConfigV1,
} from "./directorySourceBinding";
import {
    deriveDirectoryFailureSchedule,
    DIRECTORY_FULL_RECONCILE_TARGET_MS,
    GITHUB_DIRECTORY_SYNC_TARGET_MS,
    isDirectoryErrorRetryable,
    NON_RETRYABLE_DIRECTORY_ERRORS,
    WORKOS_DIRECTORY_SYNC_TARGET_MS,
} from "./directorySourceProjection";
import { revokeExternalSourceFactsInTx } from "../memberships/externalFacts";
import { isDirectorySourceKindAllowedInTx } from "./directorySourcePolicy";
import { publishTeamChangedInTx } from "../teamChanges";

export type CreateDirectorySourceInput =
    | Readonly<{
        kind: "workos_directory";
        teamId: string;
        teamIdentityConnectionId: string;
        workosDirectoryId: string;
        displayName: string;
        now?: Date;
    }>
    | Readonly<{
        kind: "github_organization";
        teamId: string;
        githubAppInstallationId: string;
        displayName: string;
    }>;

export type CreateDirectorySourceResult =
    | Readonly<{ ok: true; sourceId: string }>
    | Readonly<{
        ok: false;
        code:
            | "directory_source_owner_not_found"
            | "directory_source_identity_mismatch"
            | "directory_source_already_exists";
    }>;

export type ClaimedDirectorySource = Readonly<{
    id: string;
    teamId: string;
    kind: TeamDirectoryBindingConfigV1["kind"];
    binding: TeamDirectoryBindingConfigV1;
    reconcileRunId: string;
    eventCursor: string | null;
    eventRangeStart: Date | null;
    observedManualSyncRequestedAt: Date | null;
    consecutiveFailureCount?: number;
}>;

export type ActiveWorkosDirectorySource = Readonly<{
    id: string;
    teamId: string;
    kind: "workos_directory";
    binding: Extract<TeamDirectoryBindingConfigV1, { kind: "workos_directory" }>;
    reconcileRunId: null;
    eventCursor: string | null;
    eventRangeStart: Date | null;
    observedManualSyncRequestedAt: null;
    consecutiveFailureCount?: number;
}>;

export type DirectorySourceLifecycleWriteResult =
    | Readonly<{ applied: true }>
    | Readonly<{ applied: false; reason: "stale_run" }>;

export async function removeDirectorySourceInTx(
    tx: Tx,
    input: Readonly<{ teamId: string; sourceId: string }>,
): Promise<Readonly<{ membershipsRemoved: number; contributionsRemoved: number }>> {
    const revoked = await revokeExternalSourceFactsInTx(tx, {
        teamId: input.teamId,
        owner: { kind: "directory_source", directorySourceId: input.sourceId },
    });
    await tx.teamDirectorySource.delete({ where: { id: input.sourceId } });
    await publishTeamChangedInTx(tx, { teamId: input.teamId });
    return revoked;
}

export async function removeDirectorySourceForObservedDeletion(input: Readonly<{
    teamId: string;
    sourceId: string;
    expectedState: "active" | "initializing";
    reconcileRunId: string | null;
    expectedPosition:
        | Readonly<{ eventCursor: string }>
        | Readonly<{ eventCursor: null; eventRangeStart: Date }>;
}>): Promise<DirectorySourceLifecycleWriteResult> {
    return await inTx(async (tx) => {
        if (!await isDirectorySourceKindAllowedInTx(tx, "workos_directory")) {
            return { applied: false, reason: "stale_run" };
        }
        const position = input.expectedPosition.eventCursor === null
            ? { eventCursor: null, eventRangeStart: input.expectedPosition.eventRangeStart }
            : { eventCursor: input.expectedPosition.eventCursor };
        const current = await tx.teamDirectorySource.findFirst({
            where: {
                id: input.sourceId,
                teamId: input.teamId,
                kind: "workos_directory",
                state: input.expectedState,
                activeReconcileRunId: input.reconcileRunId,
                ...(input.expectedState === "active" ? { manualSyncRequestedAt: null } : {}),
                ...position,
            },
            select: { id: true },
        });
        if (!current) return { applied: false, reason: "stale_run" };
        await removeDirectorySourceInTx(tx, input);
        return { applied: true };
    });
}

export async function createDirectorySource(
    input: CreateDirectorySourceInput,
): Promise<CreateDirectorySourceResult> {
    return await inTx((tx) => createDirectorySourceInTx(tx, input));
}

export async function createDirectorySourceInTx(
    tx: Tx,
    input: CreateDirectorySourceInput,
): Promise<CreateDirectorySourceResult> {
    const now = input.kind === "workos_directory" ? input.now ?? new Date() : new Date();
    const activeReconcileRunId = randomUUID();
    if (!await isDirectorySourceKindAllowedInTx(tx, input.kind)) {
        return { ok: false, code: "directory_source_owner_not_found" };
    }

    let owner:
        | Readonly<{
            externalSourceKey: string;
            bindingConfig: TeamDirectoryBindingConfigV1;
            teamIdentityConnectionId: string | null;
            githubAppInstallationId: string | null;
        }>
        | null = null;

    if (input.kind === "workos_directory") {
        // Directory sync consumes the connection as the same-Team WorkOS
        // organization carrier. A disabled connection only stops SSO sign-in,
        // matching the directory arm of the connection runtime owner; the
        // provider instance itself must still be enabled.
        const connection = await tx.teamIdentityConnection.findFirst({
            where: {
                id: input.teamIdentityConnectionId,
                teamId: input.teamId,
                providerInstance: { kind: "workos_sso", enabled: true },
            },
            include: { providerInstance: true },
        });
        if (!connection) return { ok: false, code: "directory_source_owner_not_found" };
        const documents = parseTeamIdentityConnectionDocuments({
            providerKind: connection.providerInstance.kind,
            externalReference: connection.externalReference,
            settings: connection.settings,
            lastObservation: connection.lastObservation,
            lastSuccessfulTestAt: connection.lastSuccessfulTestAt,
        });
        if (
            !documents.ok
            || documents.value.externalReference.kind !== "workos_sso"
            || documents.value.externalReference.organizationId === null
        ) {
            return { ok: false, code: "directory_source_identity_mismatch" };
        }
        owner = {
            externalSourceKey: deriveWorkosDirectoryExternalSourceKey({
                organizationId: documents.value.externalReference.organizationId,
                directoryId: input.workosDirectoryId,
            }),
            bindingConfig: {
                v: 1,
                kind: "workos_directory",
                workosDirectoryId: input.workosDirectoryId,
            },
            teamIdentityConnectionId: connection.id,
            githubAppInstallationId: null,
        };
    } else {
        const installation = await tx.gitHubAppInstallation.findUnique({
            where: { id: input.githubAppInstallationId },
            include: { registration: true },
        });
        if (!installation) return { ok: false, code: "directory_source_owner_not_found" };
        const readiness = resolveStoredGitHubDirectoryReadiness({
            teamId: input.teamId,
            home: await readHomeGovernancePolicyInTx(tx),
            installation: {
                ...installation,
                registration: {
                    ...installation.registration,
                    encryptedSecrets: Uint8Array.from(installation.registration.encryptedSecrets),
                },
            },
        });
        if (!readiness.ok) {
            return { ok: false, code: "directory_source_identity_mismatch" };
        }
        owner = {
            externalSourceKey: deriveGithubDirectoryExternalSourceKey({
                registrationId: installation.registrationId,
                installationId: installation.githubInstallationId,
                organizationId: installation.githubOrganizationId,
            }),
            bindingConfig: {
                v: 1,
                kind: "github_organization",
                githubOrganizationLogin: installation.githubOrganizationLogin,
            },
            teamIdentityConnectionId: null,
            githubAppInstallationId: installation.id,
        };
    }

    try {
        const source = await tx.teamDirectorySource.create({
            data: {
                teamId: input.teamId,
                kind: input.kind,
                state: "initializing",
                displayName: input.displayName,
                externalSourceKey: owner.externalSourceKey,
                bindingConfig: owner.bindingConfig,
                teamIdentityConnectionId: owner.teamIdentityConnectionId,
                githubAppInstallationId: owner.githubAppInstallationId,
                eventRangeStart: input.kind === "workos_directory" ? now : null,
                activeReconcileRunId,
                activeReconcileStartedAt: now,
                lastAttemptAt: now,
            },
            select: { id: true },
        });
        return { ok: true, sourceId: source.id };
    } catch (error) {
        if (isPrismaErrorCode(error, "P2002")) {
            return { ok: false, code: "directory_source_already_exists" };
        }
        throw error;
    }
}

/**
 * Select the oldest runnable source. The durable manual request is only one
 * way a source becomes due; it does not create a separate in-memory queue or
 * a priority class that can starve scheduled repair work.
 */
export async function findNextDirectorySourceDueForSync(params: Readonly<{
    now?: Date;
}> = {}): Promise<Readonly<{ id: string; mode: "full" | "incremental" }> | null> {
    const now = params.now ?? new Date();
    const fullReconcileDueBefore = new Date(now.getTime() - DIRECTORY_FULL_RECONCILE_TARGET_MS);
    const workosIncrementalDueBefore = new Date(now.getTime() - WORKOS_DIRECTORY_SYNC_TARGET_MS);
    const githubFullDueBefore = new Date(now.getTime() - GITHUB_DIRECTORY_SYNC_TARGET_MS);
    const candidate = await inTx(async (tx) => {
        const allowedKinds = (["workos_directory", "github_organization"] as const);
        const runnableKinds: typeof allowedKinds[number][] = [];
        for (const kind of allowedKinds) {
            if (await isDirectorySourceKindAllowedInTx(tx, kind)) runnableKinds.push(kind);
        }
        if (runnableKinds.length === 0) return null;
        return await tx.teamDirectorySource.findFirst({
            where: {
                AND: [
                    { kind: { in: runnableKinds } },
                    { OR: [{ retryNotBefore: null }, { retryNotBefore: { lte: now } }] },
                    { OR: [
                        { state: "initializing" },
                        {
                            state: "active",
                            activeReconcileRunId: { not: null },
                        },
                        {
                            state: { in: ["active", "needs_attention"] },
                            manualSyncRequestedAt: { not: null },
                            OR: [
                                { lastErrorCode: null },
                                { lastErrorCode: { notIn: [...NON_RETRYABLE_DIRECTORY_ERRORS] } },
                            ],
                        },
                        {
                            state: "needs_attention",
                            lastErrorCode: { notIn: [...NON_RETRYABLE_DIRECTORY_ERRORS] },
                        },
                        {
                            state: "active",
                            kind: "workos_directory",
                            OR: [
                                { lastFullReconcileAt: null },
                                { lastFullReconcileAt: { lte: fullReconcileDueBefore } },
                                { lastSuccessAt: null },
                                { lastSuccessAt: { lte: workosIncrementalDueBefore } },
                            ],
                        },
                        {
                            state: "active",
                            kind: "github_organization",
                            OR: [
                                { lastSuccessAt: null },
                                { lastSuccessAt: { lte: githubFullDueBefore } },
                            ],
                        },
                    ] },
                ],
            },
            orderBy: [{ lastAttemptAt: "asc" }, { id: "asc" }],
            select: {
                id: true,
                kind: true,
                state: true,
                manualSyncRequestedAt: true,
                lastFullReconcileAt: true,
                activeReconcileRunId: true,
            },
        });
    });
    if (!candidate) return null;
    // An outstanding attempt token on an active source is an abandoned
    // paginated observation. The incremental claim refuses such a source, so
    // routing it to incremental mode would make the same source come back due
    // forever and stall every later source; the full claim is the owner that
    // replaces the token under CAS and repairs the incomplete evidence
    // (child 05 §11.2) instead of leaving staged rows permanently fenced.
    const full = candidate.state !== "active"
        || candidate.kind === "github_organization"
        || candidate.manualSyncRequestedAt !== null
        || candidate.activeReconcileRunId !== null
        || candidate.lastFullReconcileAt === null
        || candidate.lastFullReconcileAt <= fullReconcileDueBefore;
    return { id: candidate.id, mode: full ? "full" : "incremental" };
}

/**
 * Claim one complete scan after the cluster-wide directory worker lease is
 * held. Replacing the source-local token fences an abandoned or stolen run;
 * every later page and finalizer must present the returned token.
 */
export async function claimDirectorySourceFullReconcile(params: Readonly<{
    sourceId: string;
    reconcileRunId?: string;
    now?: Date;
}>): Promise<
    | Readonly<{ ok: true; source: ClaimedDirectorySource }>
    | Readonly<{ ok: false; code: "directory_source_not_found" | "directory_sync_needs_attention" }>
> {
    const now = params.now ?? new Date();
    const reconcileRunId = params.reconcileRunId ?? randomUUID();
    return await inTx(async (tx) => {
        const current = await tx.teamDirectorySource.findUnique({
            where: { id: params.sourceId },
            select: {
                id: true,
                teamId: true,
                kind: true,
                state: true,
                bindingConfig: true,
                eventCursor: true,
                eventRangeStart: true,
                activeReconcileRunId: true,
                manualSyncRequestedAt: true,
                consecutiveFailureCount: true,
                retryNotBefore: true,
            },
        });
        if (!current) return { ok: false, code: "directory_source_not_found" } as const;
        if (current.state === "paused") {
            return { ok: false, code: "directory_sync_needs_attention" } as const;
        }
        if (current.retryNotBefore !== null && current.retryNotBefore > now) {
            return { ok: false, code: "directory_sync_needs_attention" } as const;
        }
        if (!await isDirectorySourceKindAllowedInTx(tx, current.kind)) {
            return { ok: false, code: "directory_sync_needs_attention" } as const;
        }

        let binding: TeamDirectoryBindingConfigV1 | null = null;
        try {
            binding = parseTeamDirectoryBindingConfigV1(current.bindingConfig);
        } catch {
            // Persisted source documents are untrusted at this boundary. The
            // single failure transition below quarantines malformed and
            // wrong-kind documents identically.
        }
        if (binding === null || binding.kind !== current.kind) {
            await tx.teamDirectorySource.updateMany({
                where: {
                    id: current.id,
                    state: current.state,
                    activeReconcileRunId: current.activeReconcileRunId,
                },
                data: {
                    state: "needs_attention",
                    activeReconcileRunId: null,
                    activeReconcileStartedAt: null,
                    lastErrorCode: "directory_source_identity_mismatch",
                    consecutiveFailureCount: 0,
                    retryNotBefore: null,
                },
            });
            return { ok: false, code: "directory_sync_needs_attention" } as const;
        }
        const updated = await tx.teamDirectorySource.updateMany({
            where: {
                id: current.id,
                state: current.state,
                activeReconcileRunId: current.activeReconcileRunId,
            },
            data: {
                state: "initializing",
                activeReconcileRunId: reconcileRunId,
                activeReconcileStartedAt: now,
                lastAttemptAt: now,
                lastErrorCode: null,
                consecutiveFailureCount: 0,
                retryNotBefore: null,
                ...(current.kind === "workos_directory" && current.eventCursor === null
                    ? { eventRangeStart: now }
                    : {}),
            },
        });
        if (updated.count !== 1) {
            return { ok: false, code: "directory_sync_needs_attention" } as const;
        }
        return {
            ok: true,
            source: {
                id: current.id,
                teamId: current.teamId,
                kind: current.kind,
                binding,
                reconcileRunId,
                eventCursor: current.eventCursor,
                eventRangeStart: current.kind === "workos_directory" && current.eventCursor === null
                    ? now
                    : current.eventRangeStart,
                observedManualSyncRequestedAt: current.manualSyncRequestedAt,
                consecutiveFailureCount: current.consecutiveFailureCount,
            },
        } as const;
    });
}

export async function claimWorkosDirectorySourceIncremental(params: Readonly<{
    sourceId: string;
    now?: Date;
}>): Promise<
    | Readonly<{ ok: true; source: ActiveWorkosDirectorySource }>
    | Readonly<{ ok: false; code: "directory_source_not_found" | "directory_sync_needs_attention" }>
> {
    const now = params.now ?? new Date();
    return await inTx(async (tx) => {
        const current = await tx.teamDirectorySource.findUnique({
            where: { id: params.sourceId },
            select: {
                id: true,
                teamId: true,
                kind: true,
                state: true,
                bindingConfig: true,
                eventCursor: true,
                eventRangeStart: true,
                activeReconcileRunId: true,
                manualSyncRequestedAt: true,
                consecutiveFailureCount: true,
                retryNotBefore: true,
            },
        });
        if (!current) return { ok: false, code: "directory_source_not_found" } as const;
        if (
            current.kind !== "workos_directory"
            || current.state !== "active"
            || current.activeReconcileRunId !== null
            || current.manualSyncRequestedAt !== null
        ) return { ok: false, code: "directory_sync_needs_attention" } as const;
        if (current.retryNotBefore !== null && current.retryNotBefore > now) {
            return { ok: false, code: "directory_sync_needs_attention" } as const;
        }
        if (!await isDirectorySourceKindAllowedInTx(tx, "workos_directory")) {
            return { ok: false, code: "directory_sync_needs_attention" } as const;
        }

        const binding = parseTeamDirectoryBindingConfigV1(current.bindingConfig);
        if (binding.kind !== "workos_directory") {
            return { ok: false, code: "directory_sync_needs_attention" } as const;
        }
        const claimed = await tx.teamDirectorySource.updateMany({
            where: {
                id: current.id,
                state: "active",
                kind: "workos_directory",
                activeReconcileRunId: null,
                manualSyncRequestedAt: null,
                eventCursor: current.eventCursor,
                eventRangeStart: current.eventRangeStart,
            },
            data: {
                lastAttemptAt: now,
                lastErrorCode: null,
                consecutiveFailureCount: 0,
                retryNotBefore: null,
            },
        });
        if (claimed.count !== 1) {
            return { ok: false, code: "directory_sync_needs_attention" } as const;
        }
        return {
            ok: true,
            source: {
                id: current.id,
                teamId: current.teamId,
                kind: "workos_directory",
                binding,
                reconcileRunId: null,
                eventCursor: current.eventCursor,
                eventRangeStart: current.eventRangeStart,
                observedManualSyncRequestedAt: null,
                consecutiveFailureCount: current.consecutiveFailureCount,
            },
        } as const;
    });
}

export async function markActiveWorkosDirectoryPollFailed(params: Readonly<{
    sourceId: string;
    expectedPosition:
        | Readonly<{ eventCursor: string }>
        | Readonly<{ eventCursor: null; eventRangeStart: Date }>;
    errorCode: string;
    reconcileRunId?: string;
    consecutiveFailureCount?: number;
    retryAfterMs?: number;
    now?: Date;
}>): Promise<DirectorySourceLifecycleWriteResult> {
    const now = params.now ?? new Date();
    const schedule = deriveDirectoryFailureSchedule({
        kind: "workos_directory",
        consecutiveFailureCount: params.consecutiveFailureCount ?? 0,
        failedAt: now,
        ...(params.retryAfterMs !== undefined ? { retryAfterMs: params.retryAfterMs } : {}),
    });
    const position = params.expectedPosition.eventCursor === null
        ? { eventCursor: null, eventRangeStart: params.expectedPosition.eventRangeStart }
        : { eventCursor: params.expectedPosition.eventCursor };
    const updated = await db.teamDirectorySource.updateMany({
        where: {
            id: params.sourceId,
            state: "active",
            kind: "workos_directory",
            activeReconcileRunId: params.reconcileRunId ?? null,
            manualSyncRequestedAt: null,
            ...position,
        },
        data: {
            // A paginated event observation writes projection rows before its
            // final cursor commit. If that attempt fails, leaving the source
            // active would make those incomplete rows authoritative as soon as
            // the run fence is cleared. Reuse the existing needs-attention ->
            // full-reconcile recovery path for that exact case. A one-shot
            // incremental failure has staged no partial rows and can remain
            // active for its ordinary retry.
            ...(params.reconcileRunId !== undefined ? { state: "needs_attention" as const } : {}),
            activeReconcileRunId: null,
            activeReconcileStartedAt: null,
            lastErrorCode: params.errorCode,
            ...cursorLossRecovery(params.errorCode),
            ...(isDirectoryErrorRetryable(params.errorCode)
                ? schedule
                : { consecutiveFailureCount: 0, retryNotBefore: null }),
        },
    });
    return updated.count === 1 ? { applied: true } : { applied: false, reason: "stale_run" };
}

/**
 * A rejected event bookmark cannot be advanced, skipped, or guessed forward
 * (child 05 §8.4). Dropping the unusable position under the same
 * compare-and-swap leaves the source needing attention and makes the next
 * claimed run capture a fresh replay boundary before a complete reconciliation;
 * committed native facts and the previous success horizon are untouched.
 */
function cursorLossRecovery(errorCode: string): Readonly<{
    state?: "needs_attention";
    eventCursor?: null;
    eventRangeStart?: null;
}> {
    return errorCode === "directory_cursor_expired"
        ? { state: "needs_attention", eventCursor: null, eventRangeStart: null }
        : {};
}

export async function markDirectorySourceReconcileFailed(params: Readonly<{
    sourceId: string;
    reconcileRunId: string;
    errorCode: string;
    consecutiveFailureCount?: number;
    retryAfterMs?: number;
    now?: Date;
}>): Promise<DirectorySourceLifecycleWriteResult> {
    const now = params.now ?? new Date();
    const source = await db.teamDirectorySource.findFirst({
        where: {
            id: params.sourceId,
            state: "initializing",
            activeReconcileRunId: params.reconcileRunId,
        },
        select: { kind: true },
    });
    if (!source) return { applied: false, reason: "stale_run" };
    const schedule = deriveDirectoryFailureSchedule({
        kind: source.kind,
        consecutiveFailureCount: params.consecutiveFailureCount ?? 0,
        failedAt: now,
        ...(params.retryAfterMs !== undefined ? { retryAfterMs: params.retryAfterMs } : {}),
    });
    const updated = await db.teamDirectorySource.updateMany({
        where: {
            id: params.sourceId,
            state: "initializing",
            activeReconcileRunId: params.reconcileRunId,
        },
        data: {
            state: "needs_attention",
            activeReconcileRunId: null,
            activeReconcileStartedAt: null,
            lastErrorCode: params.errorCode,
            ...cursorLossRecovery(params.errorCode),
            ...(isDirectoryErrorRetryable(params.errorCode)
                ? schedule
                : { consecutiveFailureCount: 0, retryNotBefore: null }),
        },
    });
    return updated.count === 1 ? { applied: true } : { applied: false, reason: "stale_run" };
}

export async function requestDirectorySourceSync(params: Readonly<{
    sourceId: string;
    now?: Date;
}>): Promise<
    | Readonly<{ ok: true; status: "requested" | "coalesced" }>
    | Readonly<{ ok: false; code: "directory_source_not_found" | "directory_sync_needs_attention" }>
> {
    const now = params.now ?? new Date();
    return await inTx((tx) => requestDirectorySourceSyncInTx(tx, { ...params, now }));
}

export async function requestDirectorySourceSyncInTx(
    tx: Tx,
    params: Readonly<{ sourceId: string; now?: Date }>,
): Promise<
    | Readonly<{ ok: true; status: "requested" | "coalesced" }>
    | Readonly<{ ok: false; code: "directory_source_not_found" | "directory_sync_needs_attention" }>
> {
    const now = params.now ?? new Date();
    const current = await tx.teamDirectorySource.findUnique({
        where: { id: params.sourceId },
        select: { state: true, kind: true, bindingConfig: true, manualSyncRequestedAt: true },
    });
    if (!current) return { ok: false, code: "directory_source_not_found" } as const;
    if (current.state === "paused") {
        return { ok: false, code: "directory_sync_needs_attention" } as const;
    }
    if (!await isDirectorySourceKindAllowedInTx(tx, current.kind)) {
        return { ok: false, code: "directory_sync_needs_attention" } as const;
    }
    // A durable request must be work the claim path can serve. Both claims
    // refuse a source whose binding document no longer parses for its kind, so
    // accepting such a request here would persist unsatisfiable work and keep
    // the source selectable forever without ever being claimable.
    try {
        if (parseTeamDirectoryBindingConfigV1(current.bindingConfig).kind !== current.kind) {
            return { ok: false, code: "directory_sync_needs_attention" } as const;
        }
    } catch {
        return { ok: false, code: "directory_sync_needs_attention" } as const;
    }
    if (current.manualSyncRequestedAt !== null) {
        return { ok: true, status: "coalesced" } as const;
    }
    await tx.teamDirectorySource.update({
        where: { id: params.sourceId },
        data: { manualSyncRequestedAt: now },
    });
    return {
        ok: true,
        status: current.state === "initializing" ? "coalesced" : "requested",
    } as const;
}
