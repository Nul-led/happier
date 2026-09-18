import { withTeamSessionAccessEffectsInTx } from "../memberships/sessionAccessEffects";
import { publishTeamChangedInTx } from "../teamChanges";
import { inTx, type Tx } from "@/storage/inTx";
import {
    applyExternalGroupContributionInTx,
    applyExternalManagedGroupInTx,
    applyExternalTeamMembershipInTx,
    removeExternalGroupBindingInTx,
} from "../memberships/externalFacts";
import type { DirectoryGroup, DirectoryGroupMember, DirectoryPerson } from "./directorySourceEvidence";
import {
    isDirectorySourceCompletedEvidenceAllowedInTx,
    isDirectorySourceKindAllowedInTx,
} from "./directorySourcePolicy";

export type DirectoryProjectionWriteResult =
    | Readonly<{ applied: true }>
    | Readonly<{ applied: false; reason: "stale_run" }>;

type DirectoryProjectionPage = Readonly<{
    sourceId: string;
    reconcileRunId: string;
    people?: readonly DirectoryPerson[];
    groups?: readonly DirectoryGroup[];
    groupMembers?: readonly DirectoryGroupMember[];
}>;

export type InitializingWorkosProjectionEvent = DirectoryProjectionPage & Readonly<{
    expectedPosition:
        | Readonly<{ eventCursor: string }>
        | Readonly<{ eventCursor: null; eventRangeStart: Date }>;
    eventId: string;
    attemptId?: string;
    deletedPeople?: readonly DirectoryPerson[];
    deletedGroups?: readonly DirectoryGroup[];
    replaceGroupMembers?: readonly Readonly<{
        externalGroupId: string;
    }>[];
}>;

export type InitializingWorkosGroupMemberEventPage = Readonly<{
    sourceId: string;
    reconcileRunId: string;
    expectedPosition: InitializingWorkosProjectionEvent["expectedPosition"];
    eventId: string;
    attemptId: string;
    externalGroupId: string;
    people: readonly DirectoryPerson[];
}>;

function normalizeOptionalText(value: string | undefined): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalEmail(value: string | undefined): string | null {
    return normalizeOptionalText(value)?.toLowerCase() ?? null;
}

function preserveOptionalOpaqueId(value: string | undefined): string | null {
    return value === undefined || value.length === 0 ? null : value;
}

async function applyPerson(tx: Tx, params: DirectoryProjectionPage, person: DirectoryPerson): Promise<void> {
    const externalUpdatedAt = person.externalUpdatedAt ?? null;
    const observation = {
        externalSubjectId: preserveOptionalOpaqueId(person.externalSubjectId),
        normalizedEmail: normalizeOptionalEmail(person.email),
        displayName: normalizeOptionalText(person.displayName),
        externalLogin: normalizeOptionalText(person.login),
        state: person.active ? "active" as const : "suspended" as const,
        externalUpdatedAt,
    };
    await tx.teamProvisionedIdentity.upsert({
        where: {
            directorySourceId_externalUserId: {
                directorySourceId: params.sourceId,
                externalUserId: person.externalUserId,
            },
        },
        create: {
            // The source relation materializes both directorySourceId and its
            // Team discriminator, which keeps any later membership binding on
            // the same Team at the database boundary.
            source: { connect: { id: params.sourceId } },
            externalUserId: person.externalUserId,
            ...observation,
            lastSeenReconcileRunId: params.reconcileRunId,
        },
        update: { lastSeenReconcileRunId: params.reconcileRunId },
    });
    await tx.teamProvisionedIdentity.updateMany({
        where: {
            directorySourceId: params.sourceId,
            externalUserId: person.externalUserId,
            ...(externalUpdatedAt === null
                ? { externalUpdatedAt: null }
                : { OR: [{ externalUpdatedAt: null }, { externalUpdatedAt: { lt: externalUpdatedAt } }] }),
        },
        data: observation,
    });
}

async function applyGroup(tx: Tx, params: DirectoryProjectionPage, group: DirectoryGroup): Promise<void> {
    const externalUpdatedAt = group.externalUpdatedAt ?? null;
    const observation = {
        externalDisplayName: group.displayName,
        state: "active" as const,
        externalUpdatedAt,
    };
    await tx.teamDirectoryGroup.upsert({
        where: {
            directorySourceId_externalGroupId: {
                directorySourceId: params.sourceId,
                externalGroupId: group.externalGroupId,
            },
        },
        create: {
            directorySourceId: params.sourceId,
            externalGroupId: group.externalGroupId,
            ...observation,
            lastSeenReconcileRunId: params.reconcileRunId,
        },
        update: { lastSeenReconcileRunId: params.reconcileRunId },
    });
    await tx.teamDirectoryGroup.updateMany({
        where: {
            directorySourceId: params.sourceId,
            externalGroupId: group.externalGroupId,
            ...(externalUpdatedAt === null
                ? { externalUpdatedAt: null }
                : { OR: [{ externalUpdatedAt: null }, { externalUpdatedAt: { lt: externalUpdatedAt } }] }),
        },
        data: observation,
    });
}

async function applyDeletedPerson(
    tx: Tx,
    params: DirectoryProjectionPage,
    person: DirectoryPerson,
): Promise<void> {
    await applyPerson(tx, params, person);
    const externalUpdatedAt = person.externalUpdatedAt ?? null;
    const deleted = await tx.teamProvisionedIdentity.updateMany({
        where: {
            directorySourceId: params.sourceId,
            externalUserId: person.externalUserId,
            ...(externalUpdatedAt === null
                ? {}
                : { OR: [{ externalUpdatedAt: null }, { externalUpdatedAt: { lte: externalUpdatedAt } }] }),
        },
        data: { state: "deleted", lastSeenReconcileRunId: params.reconcileRunId },
    });
    if (deleted.count === 1) {
        await tx.teamDirectoryGroupMember.deleteMany({
            where: {
                directorySourceId: params.sourceId,
                externalUserId: person.externalUserId,
            },
        });
    }
}

async function applyDeletedGroup(
    tx: Tx,
    params: DirectoryProjectionPage,
    group: DirectoryGroup,
): Promise<void> {
    await applyGroup(tx, params, group);
    const externalUpdatedAt = group.externalUpdatedAt ?? null;
    const deleted = await tx.teamDirectoryGroup.updateMany({
        where: {
            directorySourceId: params.sourceId,
            externalGroupId: group.externalGroupId,
            ...(externalUpdatedAt === null
                ? {}
                : { OR: [{ externalUpdatedAt: null }, { externalUpdatedAt: { lte: externalUpdatedAt } }] }),
        },
        data: { state: "deleted", lastSeenReconcileRunId: params.reconcileRunId },
    });
    if (deleted.count === 1) {
        await tx.teamDirectoryGroupMember.deleteMany({
            where: {
                directorySourceId: params.sourceId,
                externalGroupId: group.externalGroupId,
            },
        });
    }
}

function workosEventStageMarker(eventId: string, attemptId?: string): string {
    return `workos-event:${eventId}:${attemptId ?? "self-contained"}`;
}

async function stageKnownGroupMembers(
    tx: Tx,
    params: Readonly<{
        sourceId: string;
        externalGroupId: string;
        people: readonly DirectoryPerson[];
        marker: string;
        personReconcileRunId: string;
    }>,
): Promise<void> {
    const externalUserIds = [...new Set(params.people.map((person) => person.externalUserId))];
    for (const person of params.people) {
        await applyPerson(tx, {
            sourceId: params.sourceId,
            reconcileRunId: params.personReconcileRunId,
        }, person);
    }
    for (const externalUserId of externalUserIds) {
        await tx.teamDirectoryGroupMember.upsert({
            where: {
                directorySourceId_externalGroupId_externalUserId: {
                    directorySourceId: params.sourceId,
                    externalGroupId: params.externalGroupId,
                    externalUserId,
                },
            },
            create: {
                directorySourceId: params.sourceId,
                externalGroupId: params.externalGroupId,
                externalUserId,
                lastSeenReconcileRunId: params.marker,
            },
            update: { lastSeenReconcileRunId: params.marker },
        });
    }
}

async function replaceGroupMembers(
    tx: Tx,
    params: DirectoryProjectionPage & Readonly<{ attemptId?: string }>,
    replacement: Readonly<{ externalGroupId: string }>,
    eventId: string,
): Promise<void> {
    const marker = workosEventStageMarker(eventId, params.attemptId);
    await tx.teamDirectoryGroupMember.deleteMany({
        where: {
            directorySourceId: params.sourceId,
            externalGroupId: replacement.externalGroupId,
            NOT: { lastSeenReconcileRunId: marker },
        },
    });
    await tx.teamDirectoryGroupMember.updateMany({
        where: {
            directorySourceId: params.sourceId,
            externalGroupId: replacement.externalGroupId,
            lastSeenReconcileRunId: marker,
        },
        data: { lastSeenReconcileRunId: params.reconcileRunId },
    });
}

async function applyProjectionPageInTx(tx: Tx, params: DirectoryProjectionPage): Promise<void> {
    for (const person of params.people ?? []) await applyPerson(tx, params, person);
    for (const group of params.groups ?? []) await applyGroup(tx, params, group);
    for (const member of params.groupMembers ?? []) {
        await tx.teamDirectoryGroupMember.upsert({
            where: {
                directorySourceId_externalGroupId_externalUserId: {
                    directorySourceId: params.sourceId,
                    externalGroupId: member.externalGroupId,
                    externalUserId: member.externalUserId,
                },
            },
            create: {
                directorySourceId: params.sourceId,
                externalGroupId: member.externalGroupId,
                externalUserId: member.externalUserId,
                lastSeenReconcileRunId: params.reconcileRunId,
            },
            update: { lastSeenReconcileRunId: params.reconcileRunId },
        });
    }
}

async function applyWorkosProjectionEventInTx(
    tx: Tx,
    params: InitializingWorkosProjectionEvent,
    eventId: string,
): Promise<void> {
    await applyProjectionPageInTx(tx, params);
    for (const person of params.deletedPeople ?? []) await applyDeletedPerson(tx, params, person);
    for (const group of params.deletedGroups ?? []) await applyDeletedGroup(tx, params, group);
    for (const replacement of params.replaceGroupMembers ?? []) {
        await replaceGroupMembers(tx, params, replacement, eventId);
    }
}

export async function commitInitializingWorkosProjectionEvent(
    _params: InitializingWorkosProjectionEvent,
): Promise<DirectoryProjectionWriteResult> {
    const params = _params;
    const eventId = params.eventId.trim();
    if (eventId.length === 0) throw new TypeError("WorkOS event ID must be non-empty");
    return await inTx(async (tx): Promise<DirectoryProjectionWriteResult> => {
        if (!await isDirectorySourceKindAllowedInTx(tx, "workos_directory")) {
            return { applied: false, reason: "stale_run" };
        }
        const position = params.expectedPosition.eventCursor === null
            ? { eventCursor: null, eventRangeStart: params.expectedPosition.eventRangeStart }
            : { eventCursor: params.expectedPosition.eventCursor };
        const sourceWhere = {
            id: params.sourceId,
            kind: "workos_directory" as const,
            state: "initializing" as const,
            activeReconcileRunId: params.reconcileRunId,
            ...position,
        };
        const current = await tx.teamDirectorySource.findFirst({
            where: sourceWhere,
            select: { id: true },
        });
        if (!current) return { applied: false, reason: "stale_run" };

        await applyWorkosProjectionEventInTx(tx, params, eventId);
        const advanced = await tx.teamDirectorySource.updateMany({
            where: sourceWhere,
            data: { eventCursor: eventId, eventRangeStart: null },
        });
        if (advanced.count !== 1) {
            // A concurrent replacement must roll back the projection writes from
            // this event rather than committing them without its opaque cursor.
            throw new StaleProjectionRunError();
        }
        return { applied: true };
    }).catch((error: unknown) => {
        if (error instanceof StaleProjectionRunError) return { applied: false, reason: "stale_run" };
        throw error;
    });
}

/**
 * Stage one bounded current-membership page without advancing the WorkOS
 * cursor. The final event transaction removes rows not stamped by this event,
 * restores the reconcile-run stamp, and advances the cursor atomically.
 */
export async function stageInitializingWorkosGroupMemberEventPage(
    params: InitializingWorkosGroupMemberEventPage,
): Promise<DirectoryProjectionWriteResult> {
    const eventId = params.eventId.trim();
    if (eventId.length === 0) throw new TypeError("WorkOS event ID must be non-empty");
    return await inTx(async (tx): Promise<DirectoryProjectionWriteResult> => {
        if (!await isDirectorySourceKindAllowedInTx(tx, "workos_directory")) {
            return { applied: false, reason: "stale_run" };
        }
        const position = params.expectedPosition.eventCursor === null
            ? { eventCursor: null, eventRangeStart: params.expectedPosition.eventRangeStart }
            : { eventCursor: params.expectedPosition.eventCursor };
        const current = await tx.teamDirectorySource.findFirst({
            where: {
                id: params.sourceId,
                kind: "workos_directory",
                state: "initializing",
                activeReconcileRunId: params.reconcileRunId,
                ...position,
            },
            select: { id: true },
        });
        if (!current) return { applied: false, reason: "stale_run" };

        await stageKnownGroupMembers(tx, {
            sourceId: params.sourceId,
            externalGroupId: params.externalGroupId,
            people: params.people,
            marker: workosEventStageMarker(eventId, params.attemptId),
            personReconcileRunId: params.reconcileRunId,
        });
        return { applied: true };
    });
}

export async function stageActiveWorkosGroupMemberEventPage(
    params: Omit<InitializingWorkosGroupMemberEventPage, "reconcileRunId">,
): Promise<DirectoryProjectionWriteResult> {
    const eventId = params.eventId.trim();
    if (eventId.length === 0) throw new TypeError("WorkOS event ID must be non-empty");
    return await inTx(async (tx): Promise<DirectoryProjectionWriteResult> => {
        if (!await isDirectorySourceKindAllowedInTx(tx, "workos_directory")) {
            return { applied: false, reason: "stale_run" };
        }
        const position = params.expectedPosition.eventCursor === null
            ? { eventCursor: null, eventRangeStart: params.expectedPosition.eventRangeStart }
            : { eventCursor: params.expectedPosition.eventCursor };
        await tx.teamDirectorySource.updateMany({
            where: {
                id: params.sourceId,
                kind: "workos_directory",
                state: "active",
                activeReconcileRunId: null,
                manualSyncRequestedAt: null,
                ...position,
            },
            data: {
                activeReconcileRunId: params.attemptId,
                activeReconcileStartedAt: new Date(),
            },
        });
        const current = await tx.teamDirectorySource.findFirst({
            where: {
                id: params.sourceId,
                kind: "workos_directory",
                state: "active",
                activeReconcileRunId: params.attemptId,
                manualSyncRequestedAt: null,
                ...position,
            },
            select: { id: true },
        });
        if (!current) return { applied: false, reason: "stale_run" };

        await stageKnownGroupMembers(tx, {
            sourceId: params.sourceId,
            externalGroupId: params.externalGroupId,
            people: params.people,
            marker: workosEventStageMarker(eventId, params.attemptId),
            personReconcileRunId: workosEventStageMarker(eventId, params.attemptId),
        });
        return { applied: true };
    });
}

class StaleProjectionRunError extends Error {}
class DirectoryProjectionInvariantError extends Error {}

async function hasCurrentProjectionRun(tx: Tx, params: Pick<DirectoryProjectionPage, "sourceId" | "reconcileRunId">) {
    const source = await tx.teamDirectorySource.findFirst({
        where: {
            id: params.sourceId,
            state: "initializing",
            activeReconcileRunId: params.reconcileRunId,
        },
        select: { kind: true },
    });
    return source !== null && await isDirectorySourceKindAllowedInTx(tx, source.kind);
}

export async function commitDirectoryProjectionPage(params: DirectoryProjectionPage): Promise<DirectoryProjectionWriteResult> {
    return await inTx(async (tx): Promise<DirectoryProjectionWriteResult> => {
        if (!await hasCurrentProjectionRun(tx, params)) return { applied: false, reason: "stale_run" };
        await applyProjectionPageInTx(tx, params);
        return { applied: true };
    });
}

export async function finalizeDirectoryProjection(params: Readonly<{
    sourceId: string;
    reconcileRunId: string;
}>): Promise<DirectoryProjectionWriteResult> {
    return await inTx(async (tx) => {
        if (!await hasCurrentProjectionRun(tx, params)) return { applied: false, reason: "stale_run" };
        await tx.teamDirectoryGroupMember.deleteMany({
            where: {
                directorySourceId: params.sourceId,
                OR: [
                    { lastSeenReconcileRunId: null },
                    { lastSeenReconcileRunId: { not: params.reconcileRunId } },
                ],
            },
        });
        await tx.teamProvisionedIdentity.updateMany({
            where: {
                directorySourceId: params.sourceId,
                OR: [
                    { lastSeenReconcileRunId: null },
                    { lastSeenReconcileRunId: { not: params.reconcileRunId } },
                ],
            },
            data: { state: "deleted" },
        });
        await tx.teamDirectoryGroup.updateMany({
            where: {
                directorySourceId: params.sourceId,
                OR: [
                    { lastSeenReconcileRunId: null },
                    { lastSeenReconcileRunId: { not: params.reconcileRunId } },
                ],
            },
            data: { state: "deleted" },
        });
        return { applied: true };
    });
}

type NativeDirectoryProjectionContext = Readonly<{
    teamId: string;
    team: Readonly<{ defaultSessionHistoryAccess: import("@/storage/enums.generated").SessionHistoryAccess }>;
}>;

/**
 * Applying one source's facts for named Accounts only. Sign-in binding uses it
 * so admitting one person never rewrites a whole directory inside an
 * interactive transaction; Group metadata stays with the reconciler, which is
 * the only owner of a complete observation.
 */
type NativeDirectoryProjectionScope = Readonly<{ accountIds: readonly string[] }>;

async function applyNativeDirectoryFactsInTx(
    tx: Tx,
    current: NativeDirectoryProjectionContext,
    sourceId: string,
    scope?: NativeDirectoryProjectionScope,
): Promise<void> {
    const identities = await tx.teamProvisionedIdentity.findMany({
        where: {
            directorySourceId: sourceId,
            boundAccountId: scope ? { in: [...scope.accountIds] } : { not: null },
        },
        select: {
            externalUserId: true,
            boundAccountId: true,
            state: true,
        },
    });
    const bindings = await tx.teamExternalGroupBinding.findMany({
        where: { directorySourceId: sourceId },
        select: {
            id: true,
            teamGroupId: true,
            externalGroupId: true,
            group: { select: { memberships: { select: { teamMembership: { select: { accountId: true } } } } } },
        },
    });
    const accountIds = scope
        ? [...scope.accountIds]
        : [
            ...identities.flatMap(identity => identity.boundAccountId ?? []),
            ...bindings.flatMap(binding => binding.group.memberships.map(member => member.teamMembership.accountId)),
        ];
    const inScope = (accountId: string) => scope === undefined || scope.accountIds.includes(accountId);
    // The whole delta is one Team change. Every leaf below is told not to
    // publish, the affected Accounts are accumulated, and the audience is
    // woken exactly once at the end instead of once per materialized row.
    const changedAccountIds = new Set<string>();
    let teamChanged = false;
    await withTeamSessionAccessEffectsInTx(tx, { teamId: current.teamId, accountIds, origin: "retained_lifecycle" }, async (sessionAccessImpacts) => {
        for (const identity of identities) {
            if (!identity.boundAccountId) continue;
            const applied = await applyExternalTeamMembershipInTx(tx, {
                teamId: current.teamId,
                accountId: identity.boundAccountId,
                source: {
                    kind: "directory_source",
                    directorySourceId: sourceId,
                    externalUserId: identity.externalUserId,
                },
                desired: identity.state === "deleted" ? "absent" : identity.state,
                historyAccess: current.team.defaultSessionHistoryAccess,
                sessionAccessImpacts,
                publishChange: false,
            });
            if (applied.status === "source_not_found") {
                throw new DirectoryProjectionInvariantError("bound identity lost its directory source");
            }
            if (applied.status === "management_conflict") {
                throw new DirectoryProjectionInvariantError("bound identity disagrees with its Team membership owner");
            }
            // An archived Team deliberately suppresses new admission while
            // retained removals in the same complete observation still apply.
            if (applied.status === "team_archived") continue;
            if (applied.status === "applied") {
                teamChanged = true;
                changedAccountIds.add(applied.accountId);
            }
        }

        for (const binding of bindings) {
            const projectedGroup = await tx.teamDirectoryGroup.findUnique({
                where: {
                    directorySourceId_externalGroupId: {
                        directorySourceId: sourceId,
                        externalGroupId: binding.externalGroupId,
                    },
                },
                select: { state: true, externalDisplayName: true },
            });
            if (!scope) {
                if (!projectedGroup || projectedGroup.state !== "active") {
                    const removed = await removeExternalGroupBindingInTx(tx, {
                        teamId: current.teamId,
                        bindingId: binding.id,
                        sessionAccessImpacts,
                        publishChange: false,
                    });
                    if (removed.status === "already_absent") {
                        throw new DirectoryProjectionInvariantError("directory Group binding disappeared during reconciliation");
                    }
                    teamChanged = true;
                    for (const accountId of removed.affectedAccountIds) changedAccountIds.add(accountId);
                    continue;
                }
                const metadata = await applyExternalManagedGroupInTx(tx, {
                    teamId: current.teamId,
                    externalGroupBindingId: binding.id,
                    desired: "active",
                    sessionAccessImpacts,
                    sourceDisplayName: projectedGroup.externalDisplayName,
                    publishChange: false,
                });
                if (metadata.status === "binding_not_found") {
                    throw new DirectoryProjectionInvariantError("directory Group binding lost its target");
                }
                if (metadata.status === "applied") teamChanged = true;
            } else if (projectedGroup?.state !== "active") {
                // A Group the last complete observation did not confirm cannot
                // contribute a roster member during sign-in.
                continue;
            }

            const projectedMembers = await tx.teamDirectoryGroupMember.findMany({
                where: {
                    directorySourceId: sourceId,
                    externalGroupId: binding.externalGroupId,
                    identity: {
                        boundAccountId: { not: null },
                        teamMembershipId: { not: null },
                        state: { in: ["active", "suspended"] },
                    },
                },
                select: { identity: { select: { boundAccountId: true } } },
            });
            const desiredAccountIds = new Set(
                projectedMembers
                    .flatMap((member) => member.identity.boundAccountId ?? [])
                    .filter(inScope),
            );
            // Team removal above cascades its contributions. Read the surviving
            // roster now, while the access before-state remains the outer capture.
            const currentContributions = await tx.teamGroupMembershipExternalContribution.findMany({
                where: { externalGroupBindingId: binding.id },
                select: { membership: { select: { teamMembership: { select: { accountId: true } } } } },
            });
            const existingAccountIds = new Set(
                currentContributions
                    .map((contribution) => contribution.membership.teamMembership.accountId)
                    .filter(inScope),
            );
            for (const accountId of desiredAccountIds) {
                const contribution = await applyExternalGroupContributionInTx(tx, {
                    teamId: current.teamId,
                    groupId: binding.teamGroupId,
                    accountId,
                    externalGroupBindingId: binding.id,
                    desired: "present",
                    historyAccess: current.team.defaultSessionHistoryAccess,
                    sessionAccessImpacts,
                    publishChange: false,
                });
                // An archived native target retains no dormant new member. Its
                // projection stays current and a later active reconciliation
                // may materialize the relationship after explicit restore.
                if (contribution.status === "group_archived") continue;
                if (contribution.status !== "ok") {
                    throw new DirectoryProjectionInvariantError("directory Group contribution lost its binding or Team membership");
                }
                if (contribution.outcome !== "unchanged") {
                    teamChanged = true;
                    changedAccountIds.add(accountId);
                }
            }
            for (const accountId of existingAccountIds) {
                if (desiredAccountIds.has(accountId)) continue;
                const contribution = await applyExternalGroupContributionInTx(tx, {
                    teamId: current.teamId,
                    groupId: binding.teamGroupId,
                    accountId,
                    externalGroupBindingId: binding.id,
                    desired: "absent",
                    historyAccess: current.team.defaultSessionHistoryAccess,
                    sessionAccessImpacts,
                    publishChange: false,
                });
                if (contribution.status !== "ok") {
                    throw new DirectoryProjectionInvariantError("existing directory Group contribution became invalid");
                }
                if (contribution.outcome !== "unchanged") {
                    teamChanged = true;
                    changedAccountIds.add(accountId);
                }
            }
        }
    });
    if (teamChanged) {
        await publishTeamChangedInTx(tx, {
            teamId: current.teamId,
            additionalAccountIds: [...changedAccountIds],
        });
    }
}

/**
 * Materialize one Account's share of a directory source's committed evidence.
 *
 * Readiness is the gate: only a source that is `active` with no outstanding
 * full-run token has a complete validated projection, so an interrupted import
 * or repair can never turn a staged observation into access — not through
 * sign-in, and not through a later binding edit. The write itself goes through
 * the same canonical external-fact owners the reconciler uses.
 */
export async function applyReadyDirectorySourceFactsForAccountInTx(
    tx: Tx,
    params: Readonly<{ sourceId: string; teamId: string; accountId: string }>,
): Promise<boolean> {
    const current = await tx.teamDirectorySource.findFirst({
        where: {
            id: params.sourceId,
            teamId: params.teamId,
        },
        select: {
            teamId: true,
            kind: true,
            state: true,
            activeReconcileRunId: true,
            team: { select: { defaultSessionHistoryAccess: true } },
        },
    });
    if (!current) return false;
    if (!await isDirectorySourceCompletedEvidenceAllowedInTx(tx, current)) return false;
    await applyNativeDirectoryFactsInTx(tx, current, params.sourceId, { accountIds: [params.accountId] });
    return true;
}

export async function commitActiveWorkosProjectionEvent(
    params: Omit<InitializingWorkosProjectionEvent, "reconcileRunId"> & Readonly<{ completedAt?: Date }>,
): Promise<DirectoryProjectionWriteResult> {
    const eventId = params.eventId.trim();
    if (eventId.length === 0) throw new TypeError("WorkOS event ID must be non-empty");
    const completedAt = params.completedAt ?? new Date();
    return await inTx(async (tx): Promise<DirectoryProjectionWriteResult> => {
        if (!await isDirectorySourceKindAllowedInTx(tx, "workos_directory")) {
            return { applied: false, reason: "stale_run" };
        }
        const position = params.expectedPosition.eventCursor === null
            ? { eventCursor: null, eventRangeStart: params.expectedPosition.eventRangeStart }
            : { eventCursor: params.expectedPosition.eventCursor };
        const sourceWhere = {
            id: params.sourceId,
            kind: "workos_directory" as const,
            state: "active" as const,
            activeReconcileRunId: params.attemptId ?? null,
            manualSyncRequestedAt: null,
            ...position,
        };
        const current = await tx.teamDirectorySource.findFirst({
            where: sourceWhere,
            select: {
                id: true,
                teamId: true,
                team: { select: { defaultSessionHistoryAccess: true } },
            },
        });
        if (!current) return { applied: false, reason: "stale_run" };

        await applyWorkosProjectionEventInTx(tx, {
            ...params,
            reconcileRunId: workosEventStageMarker(eventId, params.attemptId),
        }, eventId);
        await applyNativeDirectoryFactsInTx(tx, current, params.sourceId);
        const advanced = await tx.teamDirectorySource.updateMany({
            where: sourceWhere,
            data: {
                eventCursor: eventId,
                eventRangeStart: null,
                activeReconcileRunId: null,
                activeReconcileStartedAt: null,
                lastSuccessAt: completedAt,
                lastErrorCode: null,
                consecutiveFailureCount: 0,
                retryNotBefore: null,
            },
        });
        if (advanced.count !== 1) throw new StaleProjectionRunError();
        return { applied: true };
    }).catch((error: unknown) => {
        if (error instanceof StaleProjectionRunError) return { applied: false, reason: "stale_run" };
        throw error;
    });
}

export async function completeActiveWorkosEmptyPoll(params: Readonly<{
    sourceId: string;
    expectedPosition: InitializingWorkosProjectionEvent["expectedPosition"];
    completedAt?: Date;
}>): Promise<DirectoryProjectionWriteResult> {
    const completedAt = params.completedAt ?? new Date();
    const position = params.expectedPosition.eventCursor === null
        ? { eventCursor: null, eventRangeStart: params.expectedPosition.eventRangeStart }
        : { eventCursor: params.expectedPosition.eventCursor };
    return await inTx(async (tx) => {
        if (!await isDirectorySourceKindAllowedInTx(tx, "workos_directory")) {
            return { applied: false, reason: "stale_run" };
        }
        const updated = await tx.teamDirectorySource.updateMany({
            where: {
                id: params.sourceId,
                kind: "workos_directory",
                state: "active",
                activeReconcileRunId: null,
                manualSyncRequestedAt: null,
                ...position,
            },
            data: {
                lastSuccessAt: completedAt,
                lastErrorCode: null,
                consecutiveFailureCount: 0,
                retryNotBefore: null,
            },
        });
        return updated.count === 1 ? { applied: true } : { applied: false, reason: "stale_run" };
    });
}

/**
 * Atomically activate one complete projection and its native effects.
 *
 * Projection rows remain evidence. Account bindings and Group bindings are the
 * only bridges into native authorization, and every mutation crosses the
 * canonical external-fact adapters before the source's success cursor becomes
 * visible. A failed transaction therefore publishes neither partial access nor
 * a success marker for access that was not applied.
 */
export async function completeDirectoryProjection(params: Readonly<{
    sourceId: string;
    reconcileRunId: string;
    observedManualSyncRequestedAt: Date | null;
    completedAt?: Date;
}>): Promise<DirectoryProjectionWriteResult> {
    const completedAt = params.completedAt ?? new Date();
    return await inTx(async (tx): Promise<DirectoryProjectionWriteResult> => {
        const current = await tx.teamDirectorySource.findFirst({
            where: {
                id: params.sourceId,
                state: "initializing",
                activeReconcileRunId: params.reconcileRunId,
            },
            select: {
                id: true,
                teamId: true,
                kind: true,
                manualSyncRequestedAt: true,
                team: { select: { defaultSessionHistoryAccess: true } },
            },
        });
        if (!current) return { applied: false, reason: "stale_run" };
        if (!await isDirectorySourceKindAllowedInTx(tx, current.kind)) {
            return { applied: false, reason: "stale_run" };
        }

        await tx.teamDirectoryGroupMember.deleteMany({
            where: {
                directorySourceId: params.sourceId,
                OR: [
                    { lastSeenReconcileRunId: null },
                    { lastSeenReconcileRunId: { not: params.reconcileRunId } },
                ],
            },
        });
        await tx.teamProvisionedIdentity.updateMany({
            where: {
                directorySourceId: params.sourceId,
                OR: [
                    { lastSeenReconcileRunId: null },
                    { lastSeenReconcileRunId: { not: params.reconcileRunId } },
                ],
            },
            data: { state: "deleted" },
        });
        await tx.teamDirectoryGroup.updateMany({
            where: {
                directorySourceId: params.sourceId,
                OR: [
                    { lastSeenReconcileRunId: null },
                    { lastSeenReconcileRunId: { not: params.reconcileRunId } },
                ],
            },
            data: { state: "deleted" },
        });

        await applyNativeDirectoryFactsInTx(tx, current, params.sourceId);

        const clearObservedManualRequest = params.observedManualSyncRequestedAt !== null
            && current.manualSyncRequestedAt !== null
            && current.manualSyncRequestedAt.getTime() <= params.observedManualSyncRequestedAt.getTime();
        const completed = await tx.teamDirectorySource.updateMany({
            where: {
                id: params.sourceId,
                state: "initializing",
                activeReconcileRunId: params.reconcileRunId,
            },
            data: {
                state: "active",
                activeReconcileRunId: null,
                activeReconcileStartedAt: null,
                lastSuccessAt: completedAt,
                lastFullReconcileAt: completedAt,
                lastErrorCode: null,
                consecutiveFailureCount: 0,
                retryNotBefore: null,
                ...(clearObservedManualRequest ? { manualSyncRequestedAt: null } : {}),
            },
        });
        if (completed.count !== 1) throw new StaleProjectionRunError();
        return { applied: true };
    }).catch((error: unknown) => {
        if (error instanceof StaleProjectionRunError) return { applied: false, reason: "stale_run" };
        throw error;
    });
}
