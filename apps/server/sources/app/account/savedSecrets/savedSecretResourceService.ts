import {
    formatSharedSavedSecretRefV1,
    TeamRoleV1Schema,
    parseEncryptedDataKeyEnvelopeV1,
    SavedSecretCatalogEntryV1Schema,
    SavedSecretResourceStoredContentV1Schema,
    type SavedSecretCatalogEntryV1,
    type SavedSecretCatalogCorruptEntryV1,
    type SavedSecretCatalogResultV1,
    type SavedSecretResourceEnvelopeCensusRecipientV1,
    type SavedSecretResourceStoredContentV1,
    type AccountSettingsStoredContentEnvelope,
} from "@happier-dev/protocol";
import { isTeamPrincipalRoleV1 } from "@happier-dev/protocol/teams";
import { isDeepStrictEqual } from "node:util";
import * as privacyKit from "privacy-kit";
import { writeAccountSettingsInTx } from "@/app/accountSettings/writeAccountSettingsInTx";
import { markAccountsChanged } from "@/app/changes/markAccountChanged";
import { deriveAccountRecipientEnvelopeReadinessFromRow } from "@/app/encryption/accountRecipientEnvelopeReadiness";
import {
    resolveSessionAccessGrantAccountSubjectsInTx,
    resolveSessionAccessGrantSubjectInTx,
} from "@/app/session/access/sessionAccessGrantEligibility";
import {
    qualifyTeamOperationAuthenticationsInTx,
    resolveTeamActorContextInTx,
    resolveTeamActorContextsInTx,
    type TeamOperationAuthenticationContext,
} from "@/app/teams/actorContext";
import { resolveTeamCredentialCapabilities } from "@/app/teams/capabilities";
import {
    ACCOUNT_DISPLAY_PROFILE_SELECT,
    projectAccountDisplayProfileV1,
    type AccountDisplayProfileRow,
} from "@/app/account/profile/accountDisplayProfile";
import {
    decodeSensitiveContentFromAtRestStorage,
    encodeSensitiveContentForAtRestStorage,
} from "@/app/encryption/sensitiveContentAtRestStorage";
import type { Tx } from "@/storage/inTx";

type StoredResourceRow = Readonly<{
    id: string;
    ownerAccountId: string;
    displayName: string;
    kind: string;
    encryptionMode: string;
    revision: number;
    storedContent: string;
    owner: AccountDisplayProfileRow;
    accountGrants: readonly { accountId: string; account: AccountDisplayProfileRow }[];
    teamGrants: readonly {
        teamId: string;
        team: { id: string; name: string; memberships: readonly { accountId: string; role: string }[] };
    }[];
    groupGrants: readonly {
        teamGroupId: string;
        teamGroup: {
            id: string;
            teamId: string;
            name: string;
            team: { id: string; name: string };
            memberships: readonly { teamMembership: { accountId: string } }[];
        };
    }[];
    keyEnvelopes?: readonly Readonly<{
        encryptedDataKey: Uint8Array;
        recipientContentPublicKeyFingerprint: string;
    }>[];
}>;

type SavedSecretRecipientAccountRow = Readonly<{
    publicKey: string | null;
    encryptionMode: string | null;
    contentPublicKey: Uint8Array | null;
    contentPublicKeySig: Uint8Array | null;
}>;

/**
 * Which of these Teams the caller's exact credential currently qualifies for.
 *
 * Shared Saved Secrets own no authentication policy: they read the one Team
 * qualification owner, in this transaction, for every Team-derived arm. The
 * batch entry point is used so a catalog page costs one qualification, not one
 * per row.
 */
async function qualifiedSavedSecretTeamIdsInTx(
    tx: Tx,
    input: Readonly<{
        teamIds: readonly string[];
        actorAccountId: string;
        authentication?: TeamOperationAuthenticationContext;
    }>,
): Promise<ReadonlySet<string>> {
    const teamIds = [...new Set(input.teamIds)];
    if (teamIds.length === 0) return new Set();
    const contexts = await resolveTeamActorContextsInTx(tx, {
        teamIds,
        actorAccountId: input.actorAccountId,
    });
    if (contexts.size === 0) return new Set();
    const qualifications = await qualifyTeamOperationAuthenticationsInTx(tx, {
        ...input.authentication,
        contexts: [...contexts.values()],
    });
    const qualified = new Set<string>();
    for (const [teamId, result] of qualifications) if (result.ok) qualified.add(teamId);
    return qualified;
}

/** Every named Team qualifies, or the Team-derived operation is refused. */
async function areSavedSecretTeamsQualifiedInTx(
    tx: Tx,
    input: Readonly<{
        teamIds: readonly string[];
        actorAccountId: string;
        authentication?: TeamOperationAuthenticationContext;
    }>,
): Promise<boolean> {
    const teamIds = [...new Set(input.teamIds)];
    if (teamIds.length === 0) return true;
    const qualified = await qualifiedSavedSecretTeamIdsInTx(tx, input);
    return teamIds.every((teamId) => qualified.has(teamId));
}

type SavedSecretTeamDerivedRow = Readonly<{
    ownerAccountId: string;
    accountGrants: readonly { accountId: string }[];
    teamGrants: readonly { teamId: string }[];
    groupGrants: readonly { teamGroup: { teamId: string } }[];
}>;

/**
 * Drop the rows whose only authorization is a Team or Group arm the caller's
 * current credential does not satisfy, and say which Teams it did satisfy.
 *
 * The owner and direct-Account arms are independent of any Team policy and are
 * never touched. Only the Team-derived arms consume the Lane 03 qualification,
 * so a restricted Team never discloses its granted secrets to a member holding
 * a weaker credential — and never refuses the caller's own resources either.
 *
 * The qualified Team set is returned because the row projection needs the same
 * answer: a row kept by its direct grant must not then name a restricted Team
 * the credential never qualified through. One batch call over the union of
 * every candidate row's Teams answers both questions, so provenance and
 * retention can never disagree.
 */
async function retainQualifiedSavedSecretRowsInTx<TRow extends SavedSecretTeamDerivedRow>(
    tx: Tx,
    input: Readonly<{
        rows: readonly TRow[];
        accountId: string;
        authentication?: TeamOperationAuthenticationContext;
    }>,
): Promise<Readonly<{ rows: readonly TRow[]; qualifiedTeamIds: ReadonlySet<string> }>> {
    const qualifiedTeamIds = await qualifiedSavedSecretTeamIdsInTx(tx, {
        teamIds: input.rows.flatMap(savedSecretRowTeamIds),
        actorAccountId: input.accountId,
        authentication: input.authentication,
    });
    return {
        rows: input.rows.filter((row) => isDirectlyAuthorizedSavedSecretRow(row, input.accountId)
            || savedSecretRowTeamIds(row).some((teamId) => qualifiedTeamIds.has(teamId))),
        qualifiedTeamIds,
    };
}

function isDirectlyAuthorizedSavedSecretRow(row: SavedSecretTeamDerivedRow, accountId: string): boolean {
    return row.ownerAccountId === accountId
        || row.accountGrants.some((grant) => grant.accountId === accountId);
}

function savedSecretRowTeamIds(row: SavedSecretTeamDerivedRow): readonly string[] {
    return [
        ...row.teamGrants.map((grant) => grant.teamId),
        ...row.groupGrants.map((grant) => grant.teamGroup.teamId),
    ];
}

/**
 * Compose the existing Home-local collaboration and Team credential decisions.
 * This service owns no role, lifecycle, friendship, membership, or Group rule.
 */
async function isSavedSecretAudienceEligibleInTx(
    tx: Tx,
    input: Readonly<{
        ownerAccountId: string;
        accountIds: readonly string[];
        teamIds: readonly string[];
        groupIds: readonly string[];
        authentication?: TeamOperationAuthenticationContext;
    }>,
): Promise<boolean> {
    const groups = input.groupIds.length === 0
        ? []
        : await tx.teamGroup.findMany({
            where: { id: { in: [...input.groupIds] } },
            select: { id: true, teamId: true },
        });
    if (groups.length !== input.groupIds.length) return false;

    const teamIds = [...new Set([...input.teamIds, ...groups.map((group) => group.teamId)])];
    // A Team or Group audience is Team-derived authority, so the writer's exact
    // credential must satisfy that Team's current authentication policy before
    // the grant is persisted. Structural membership alone is not admission.
    if (!await areSavedSecretTeamsQualifiedInTx(tx, {
        teamIds,
        actorAccountId: input.ownerAccountId,
        authentication: input.authentication,
    })) return false;
    const [accountSubjects, teamSubjects, groupSubjects, teamActors] = await Promise.all([
        resolveSessionAccessGrantAccountSubjectsInTx(tx, {
            actorAccountId: input.ownerAccountId,
            sessionOwnerAccountId: input.ownerAccountId,
            subjectAccountIds: input.accountIds,
            hasExistingGrant: false,
        }),
        Promise.all(input.teamIds.map((teamId) => resolveSessionAccessGrantSubjectInTx(tx, {
            actorAccountId: input.ownerAccountId,
            sessionOwnerAccountId: input.ownerAccountId,
            subject: { kind: "team", teamId },
            hasExistingGrant: false,
        }))),
        Promise.all(groups.map((group) => resolveSessionAccessGrantSubjectInTx(tx, {
            actorAccountId: input.ownerAccountId,
            sessionOwnerAccountId: input.ownerAccountId,
            subject: { kind: "group", teamId: group.teamId, groupId: group.id },
            hasExistingGrant: false,
        }))),
        Promise.all(teamIds.map((teamId) => resolveTeamActorContextInTx(tx, {
            actorAccountId: input.ownerAccountId,
            teamId,
        }))),
    ]);
    return accountSubjects.every((result) => result.ok)
        && teamSubjects.every((result) => result.ok)
        && groupSubjects.every((result) => result.ok)
        && teamActors.every((actor) => actor !== null && resolveTeamCredentialCapabilities({
            ...actor,
            teamArchivedAt: actor.team.archivedAt,
        }).offerOwnCredential);
}

async function listAuthorizedAccountIdsForResourceInTx(
    tx: Tx,
    resourceId: string,
): Promise<readonly string[]> {
    const row = await tx.savedSecretResource.findUnique({
        where: { id: resourceId },
        select: {
            ownerAccountId: true,
            accountGrants: { select: { accountId: true } },
            teamGrants: {
                where: { team: { archivedAt: null } },
                select: {
                    team: {
                        select: {
                            memberships: {
                                where: { status: "active" },
                                select: { accountId: true, role: true },
                            },
                        },
                    },
                },
            },
            groupGrants: {
                where: { teamGroup: { archivedAt: null, team: { archivedAt: null } } },
                select: {
                    teamGroup: {
                        select: {
                            memberships: {
                                where: { teamMembership: { status: "active" } },
                                select: { teamMembership: { select: { accountId: true } } },
                            },
                        },
                    },
                },
            },
        },
    });
    if (!row) return [];
    return [...new Set([
        row.ownerAccountId,
        ...row.accountGrants.map((grant) => grant.accountId),
        ...row.teamGrants.flatMap((grant) => grant.team.memberships
            .filter((member) => {
                const role = TeamRoleV1Schema.safeParse(member.role);
                return role.success && isTeamPrincipalRoleV1(role.data);
            })
            .map((member) => member.accountId)),
        ...row.groupGrants.flatMap((grant) => grant.teamGroup.memberships.map((member) => member.teamMembership.accountId)),
    ])];
}

async function resolveSavedSecretAudienceAccountIdsInTx(
    tx: Tx,
    input: Readonly<{
        ownerAccountId: string;
        accountIds: readonly string[];
        teamIds: readonly string[];
        groupIds: readonly string[];
    }>,
): Promise<readonly string[]> {
    const [teamMembers, groupMembers] = await Promise.all([
        input.teamIds.length === 0 ? [] : tx.teamMembership.findMany({
            where: {
                teamId: { in: [...input.teamIds] },
                status: "active",
                account: { status: "active" },
                team: { archivedAt: null },
            },
            select: { accountId: true, role: true },
        }),
        input.groupIds.length === 0 ? [] : tx.teamGroupMembership.findMany({
            where: {
                teamGroupId: { in: [...input.groupIds] },
                group: { archivedAt: null, team: { archivedAt: null } },
                teamMembership: { status: "active", account: { status: "active" } },
            },
            select: { teamMembership: { select: { accountId: true } } },
        }),
    ]);
    return [...new Set([
        input.ownerAccountId,
        ...input.accountIds,
        ...teamMembers.filter((member) => isTeamPrincipalRoleV1(member.role)).map((member) => member.accountId),
        ...groupMembers.map((member) => member.teamMembership.accountId),
    ])];
}

async function markResourceChangedForAccounts(
    tx: Tx,
    resourceId: string,
    revision: number,
    accountIds: readonly string[],
): Promise<void> {
    void revision;
    await markAccountsChanged(tx, {
        accountIds,
        kind: "savedSecretResource",
        entityId: resourceId,
    });
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy;
}

function hasSameStringSet(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return rightSet.size === right.length && left.every((value) => rightSet.has(value));
}

export type SavedSecretResourceServiceError =
    | "invalid_resource"
    | "resource_not_found"
    | "forbidden"
    | "resource_changed"
    | "recipient_changed"
    | "recipient_key_unavailable"
    | "invalid_cursor"
    | "recipient_mode_unsupported"
    | "settings_conflict"
    | "settings_invalid";

export type SavedSecretResourceServiceResult<T> =
    | Readonly<{ ok: true; value: T }>
    | Readonly<{ ok: false; error: SavedSecretResourceServiceError }>;

/**
 * A typed business rejection discovered after promotion has already written rows.
 * It must escape the transaction callback so Prisma rolls every preceding write
 * back; the HTTP owner catches it only after `inTx` has completed that rollback.
 */
export class SavedSecretResourceTransactionAbort extends Error {
    readonly error: Extract<SavedSecretResourceServiceError, "settings_conflict" | "settings_invalid">;

    constructor(error: Extract<SavedSecretResourceServiceError, "settings_conflict" | "settings_invalid">) {
        super(`Saved Secret resource transaction aborted: ${error}`);
        this.name = "SavedSecretResourceTransactionAbort";
        this.error = error;
    }
}

function readStoredContent(resourceId: string, value: string): SavedSecretResourceStoredContentV1 | null {
    try {
        const opened = decodeSensitiveContentFromAtRestStorage({
            keyPath: ["storage", "saved_secret_resource", resourceId, "v1"],
            value,
        });
        const parsed = SavedSecretResourceStoredContentV1Schema.safeParse(opened);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

function storeContent(resourceId: string, content: SavedSecretResourceStoredContentV1): string {
    return encodeSensitiveContentForAtRestStorage({
        contentMode: content.t === "plain" ? "plain" : "e2ee",
        keyPath: ["storage", "saved_secret_resource", resourceId, "v1"],
        content,
    });
}

type EncryptedMaterialStatus =
    | "ready"
    | "preparing_encrypted_access"
    | "recipient_mode_unsupported"
    | "update_required";

function resolveEncryptedMaterialStatus(
    account: SavedSecretRecipientAccountRow | null,
    envelope: StoredResourceRow["keyEnvelopes"] extends readonly (infer T)[] | undefined ? T | null : never,
): EncryptedMaterialStatus {
    if (!account) return "update_required";
    const readiness = deriveAccountRecipientEnvelopeReadinessFromRow(account);
    if (readiness.status === "unavailable") {
        if (readiness.reason === "plain_account") return "recipient_mode_unsupported";
        if (readiness.reason === "encryption_setup_required") return "preparing_encrypted_access";
        return "update_required";
    }
    if (!envelope) return "preparing_encrypted_access";
    if (parseEncryptedDataKeyEnvelopeV1(new Uint8Array(envelope.encryptedDataKey)) === null) {
        return "update_required";
    }
    return envelope.recipientContentPublicKeyFingerprint
        === readiness.binding.contentPublicKeyFingerprint
        ? "ready"
        : "preparing_encrypted_access";
}

function projectCorruptRow(
    row: StoredResourceRow,
    accountId: string,
): SavedSecretCatalogCorruptEntryV1 {
    return row.ownerAccountId === accountId
        ? {
            materialStatus: "resource_corrupt",
            relationship: "owner",
            repair: {
                kind: "delete_resource",
                resourceId: row.id,
                expectedRevision: row.revision,
            },
        }
        : {
            materialStatus: "resource_corrupt",
            relationship: "recipient",
            repair: null,
        };
}

/**
 * `qualifiedTeamIds` is the set the retention pass established for this caller
 * in this transaction. Recipient provenance names only the arms that actually
 * admitted the caller, so a resource kept by a direct grant never discloses the
 * identity of a restricted Team whose policy the caller failed. Owner `audience`
 * is the roster the owner wrote and is unaffected.
 */
function projectRow(
    row: StoredResourceRow,
    accountId: string,
    encryptedMaterialStatus: EncryptedMaterialStatus,
    qualifiedTeamIds: ReadonlySet<string>,
): SavedSecretCatalogResultV1 | null {
    const isOwner = row.ownerAccountId === accountId;
    const hasDirect = row.accountGrants.some((grant) => grant.accountId === accountId);
    const matchingTeams = row.teamGrants.filter((grant) => qualifiedTeamIds.has(grant.teamId)
        && grant.team.memberships
            .some((membership) => {
                const role = TeamRoleV1Schema.safeParse(membership.role);
                return role.success && isTeamPrincipalRoleV1(role.data);
            }));
    const matchingGroups = row.groupGrants.filter((grant) => qualifiedTeamIds.has(grant.teamGroup.teamId)
        && grant.teamGroup.memberships.length > 0);
    const hasGrant = isOwner || hasDirect || matchingTeams.length > 0 || matchingGroups.length > 0;
    if (!hasGrant) return null;
    let ref: string;
    try {
        ref = formatSharedSavedSecretRefV1(row.id);
    } catch {
        return projectCorruptRow(row, accountId);
    }
    const stored = readStoredContent(row.id, row.storedContent);
    const modeMatches = (row.encryptionMode === "plain" && stored?.t === "plain")
        || (row.encryptionMode === "e2ee" && stored?.t === "encrypted");
    const metadataKind = row.kind === "apiKey" || row.kind === "token" || row.kind === "password" || row.kind === "other"
        ? row.kind : null;
    if (!metadataKind || !stored || !modeMatches) {
        return projectCorruptRow(row, accountId);
    }
    const materialStatus = row.encryptionMode === "e2ee"
        ? encryptedMaterialStatus
        : "ready";
    const projected = SavedSecretCatalogEntryV1Schema.safeParse({
        ref,
        source: "shared_resource",
        relationship: isOwner ? "owner" : "recipient",
        name: row.displayName.trim().length > 0 ? row.displayName : null,
        kind: metadataKind,
        encryptionMode: row.encryptionMode === "plain" || row.encryptionMode === "e2ee"
            ? row.encryptionMode
            : null,
        owner: {
            kind: "account",
            accountId: row.owner.id,
            ...projectAccountDisplayProfileV1(row.owner),
        },
        accessSources: isOwner ? [] : [
            ...(hasDirect ? [{ kind: "account" as const }] : []),
            ...matchingTeams.map((grant) => ({
                kind: "team" as const,
                teamId: grant.team.id,
                name: grant.team.name,
            })),
            ...matchingGroups.map((grant) => ({
                kind: "group" as const,
                teamId: grant.teamGroup.team.id,
                teamName: grant.teamGroup.team.name,
                groupId: grant.teamGroup.id,
                name: grant.teamGroup.name,
            })),
        ],
        audience: isOwner ? {
            accounts: row.accountGrants.map((grant) => ({
                kind: "account" as const,
                accountId: grant.account.id,
                ...projectAccountDisplayProfileV1(grant.account),
            })),
            teams: row.teamGrants.map((grant) => ({ kind: "team" as const, teamId: grant.team.id, name: grant.team.name })),
            groups: row.groupGrants.map((grant) => ({
                kind: "group" as const,
                teamId: grant.teamGroup.team.id,
                teamName: grant.teamGroup.team.name,
                groupId: grant.teamGroup.id,
                name: grant.teamGroup.name,
            })),
        } : null,
        ownerAccountId: row.ownerAccountId,
        revision: row.revision,
        materialStatus,
        capabilities: {
            use: materialStatus === "ready",
            rename: isOwner,
            rotate: isOwner,
            manageAccess: isOwner,
            delete: isOwner,
        },
    });
    return projected.success ? projected.data : projectCorruptRow(row, accountId);
}

/** Lists only resources currently authorized for the Account. */
export async function listSavedSecretResourcesForAccountInTx(
    tx: Tx,
    accountId: string,
    authentication?: TeamOperationAuthenticationContext,
): Promise<readonly SavedSecretCatalogResultV1[]> {
    const [rows, account] = await Promise.all([tx.savedSecretResource.findMany({
        where: {
            OR: [
                { ownerAccountId: accountId },
                { accountGrants: { some: { accountId } } },
                { teamGrants: { some: { team: { archivedAt: null, memberships: { some: { accountId, status: "active", role: { not: "guest" }, account: { status: "active" } } } } } } },
                { groupGrants: { some: { teamGroup: { archivedAt: null, team: { archivedAt: null }, memberships: { some: { teamMembership: { accountId, status: "active" } } } } } } },
            ],
        },
        orderBy: { updatedAt: "desc" },
        select: {
            id: true, ownerAccountId: true, displayName: true, kind: true,
            encryptionMode: true, revision: true, storedContent: true,
            owner: { select: ACCOUNT_DISPLAY_PROFILE_SELECT },
            accountGrants: { select: { accountId: true, account: { select: ACCOUNT_DISPLAY_PROFILE_SELECT } } },
            teamGrants: {
                select: { teamId: true, team: { select: { id: true, name: true, memberships: { where: { accountId, status: "active", account: { status: "active" } }, select: { accountId: true, role: true } } } } },
            },
            groupGrants: {
                select: { teamGroupId: true, teamGroup: { select: { id: true, teamId: true, name: true, team: { select: { id: true, name: true } }, memberships: { where: { teamMembership: { accountId, status: "active" } }, select: { teamMembership: { select: { accountId: true } } } } } } },
            },
            keyEnvelopes: {
                where: { recipientAccountId: accountId },
                select: { encryptedDataKey: true, recipientContentPublicKeyFingerprint: true },
            },
        },
    }), tx.account.findUnique({
        where: { id: accountId },
        select: {
            publicKey: true,
            encryptionMode: true,
            contentPublicKey: true,
            contentPublicKeySig: true,
        },
    })]);
    const authorized = await retainQualifiedSavedSecretRowsInTx(tx, { rows, accountId, authentication });
    return authorized.rows.flatMap((row) => {
        const projected = projectRow(
            row,
            accountId,
            resolveEncryptedMaterialStatus(account, row.keyEnvelopes[0] ?? null),
            authorized.qualifiedTeamIds,
        );
        return projected ? [projected] : [];
    });
}

export type SavedSecretResourceMaterialProjection = Readonly<{
    resourceId: string;
    entry: SavedSecretCatalogEntryV1;
    encryptionMode: "plain" | "e2ee";
    storedContent: SavedSecretResourceStoredContentV1 | null;
    encryptedDataKey: Uint8Array | null;
    recipientContentPublicKeyFingerprint: string | null;
}> | Readonly<{
    entry: SavedSecretCatalogCorruptEntryV1;
}>;

export type SavedSecretResourceEnvelopeCensusProjection = Readonly<{
    resourceId: string;
    revision: number;
    recipients: readonly SavedSecretResourceEnvelopeCensusRecipientV1[];
    nextCursor: string | null;
}>;

/** Owner-only effective-recipient census used to prepare/repair current E2EE envelopes. */
export async function listSavedSecretResourceEnvelopeCensusInTx(
    tx: Tx,
    input: Readonly<{ accountId: string; resourceId: string; cursor?: string; limit: number }>,
): Promise<SavedSecretResourceServiceResult<SavedSecretResourceEnvelopeCensusProjection>> {
    const resource = await tx.savedSecretResource.findUnique({
        where: { id: input.resourceId },
        select: { ownerAccountId: true, encryptionMode: true, revision: true },
    });
    if (!resource) return { ok: false, error: "resource_not_found" };
    if (resource.ownerAccountId !== input.accountId) return { ok: false, error: "forbidden" };
    if (resource.encryptionMode !== "e2ee") return { ok: false, error: "invalid_resource" };

    const authorizedIds = (await listAuthorizedAccountIdsForResourceInTx(tx, input.resourceId))
        .filter((id) => input.cursor === undefined || id > input.cursor)
        .sort((left, right) => left.localeCompare(right));
    const pageIds = authorizedIds.slice(0, input.limit);
    const accounts = await tx.account.findMany({
        where: { id: { in: pageIds }, status: "active" },
        select: {
            ...ACCOUNT_DISPLAY_PROFILE_SELECT,
            publicKey: true,
            encryptionMode: true,
            contentPublicKey: true,
            contentPublicKeySig: true,
            savedSecretResourceKeyEnvelopes: {
                where: { resourceId: input.resourceId },
                select: { encryptedDataKey: true, recipientContentPublicKeyFingerprint: true },
            },
        },
        orderBy: { id: "asc" },
    });
    const recipients = accounts.map((account): SavedSecretResourceEnvelopeCensusRecipientV1 => {
        const readiness = deriveAccountRecipientEnvelopeReadinessFromRow(account);
        const envelope = account.savedSecretResourceKeyEnvelopes[0] ?? null;
        const envelopeStatus = !envelope
            ? "missing" as const
            : parseEncryptedDataKeyEnvelopeV1(new Uint8Array(envelope.encryptedDataKey)) === null
                ? "invalid" as const
                : readiness.status === "available"
                    && readiness.binding.contentPublicKeyFingerprint === envelope.recipientContentPublicKeyFingerprint
                    ? "prepared" as const
                    : "stale" as const;
        return {
            account: {
                kind: "account",
                accountId: account.id,
                ...projectAccountDisplayProfileV1(account),
            },
            readiness: readiness.status === "available"
                ? {
                    status: "available",
                    contentPublicKey: privacyKit.encodeBase64(readiness.binding.contentPublicKey),
                    contentPublicKeyFingerprint: readiness.binding.contentPublicKeyFingerprint,
                }
                : readiness,
            envelopeStatus,
        };
    });
    return {
        ok: true,
        value: {
            resourceId: input.resourceId,
            revision: resource.revision,
            recipients,
            nextCursor: authorizedIds.length > input.limit ? pageIds.at(-1) ?? null : null,
        },
    };
}

/** Returns authorized ciphertext/plain storage plus only the caller's envelope. */
export async function listSavedSecretResourceMaterialsForAccountInTx(
    tx: Tx,
    accountId: string,
    authentication?: TeamOperationAuthenticationContext,
): Promise<readonly SavedSecretResourceMaterialProjection[]> {
    const [rows, account] = await Promise.all([tx.savedSecretResource.findMany({
        where: {
            OR: [
                { ownerAccountId: accountId },
                { accountGrants: { some: { accountId } } },
                { teamGrants: { some: { team: { archivedAt: null, memberships: { some: { accountId, status: "active", role: { not: "guest" }, account: { status: "active" } } } } } } },
                { groupGrants: { some: { teamGroup: { archivedAt: null, team: { archivedAt: null }, memberships: { some: { teamMembership: { accountId, status: "active" } } } } } } },
            ],
        },
        orderBy: { updatedAt: "desc" },
        select: {
            id: true, ownerAccountId: true, displayName: true, kind: true,
            encryptionMode: true, revision: true, storedContent: true,
            owner: { select: ACCOUNT_DISPLAY_PROFILE_SELECT },
            accountGrants: { select: { accountId: true, account: { select: ACCOUNT_DISPLAY_PROFILE_SELECT } } },
            teamGrants: { select: { teamId: true, team: { select: { id: true, name: true, memberships: { where: { accountId, status: "active", account: { status: "active" } }, select: { accountId: true, role: true } } } } } },
            groupGrants: {
                select: {
                    teamGroupId: true,
                    teamGroup: {
                        select: {
                            id: true,
                            teamId: true,
                            name: true,
                            team: { select: { id: true, name: true } },
                            memberships: {
                                where: { teamMembership: { accountId, status: "active" } },
                                select: { teamMembership: { select: { accountId: true } } },
                            },
                        },
                    },
                },
            },
            keyEnvelopes: { where: { recipientAccountId: accountId }, select: { encryptedDataKey: true, recipientContentPublicKeyFingerprint: true } },
        },
    }), tx.account.findUnique({
        where: { id: accountId },
        select: {
            publicKey: true,
            encryptionMode: true,
            contentPublicKey: true,
            contentPublicKeySig: true,
        },
    })]);
    const authorized = await retainQualifiedSavedSecretRowsInTx(tx, { rows, accountId, authentication });
    const projectedRows: SavedSecretResourceMaterialProjection[] = [];
    for (const row of authorized.rows) {
        const envelope = row.keyEnvelopes?.[0] ?? null;
        const entry = projectRow(
            row,
            accountId,
            resolveEncryptedMaterialStatus(account, envelope),
            authorized.qualifiedTeamIds,
        );
        if (!entry) continue;
        if (entry.materialStatus === "resource_corrupt") {
            projectedRows.push({ entry });
            continue;
        }
        const firstEnvelope = envelope;
        projectedRows.push({
            resourceId: row.id,
            entry,
            encryptionMode: row.encryptionMode === "plain" ? "plain" : "e2ee",
            storedContent: readStoredContent(row.id, row.storedContent),
            encryptedDataKey: firstEnvelope?.encryptedDataKey ?? null,
            recipientContentPublicKeyFingerprint: firstEnvelope?.recipientContentPublicKeyFingerprint ?? null,
        });
    }
    return projectedRows;
}

export type CreateSavedSecretResourceInput = Readonly<{
    accountId: string;
    authentication?: TeamOperationAuthenticationContext;
    resourceId: string;
    displayName: string;
    kind: "apiKey" | "token" | "password" | "other";
    encryptionMode: "plain" | "e2ee";
    storedContent: SavedSecretResourceStoredContentV1;
    accountGrants?: readonly string[];
    teamGrants?: readonly string[];
    groupGrants?: readonly string[];
    keyEnvelopes?: readonly Readonly<{
        recipientAccountId: string;
        encryptedDataKey: Uint8Array;
        recipientContentPublicKeyFingerprint: string;
    }>[];
}>;

/** Creates one owner-controlled resource and its explicit grant tuples. */
export async function createSavedSecretResourceInTx(
    tx: Tx,
    input: CreateSavedSecretResourceInput,
): Promise<SavedSecretResourceServiceResult<{ resourceId: string; revision: number }>> {
    try {
        formatSharedSavedSecretRefV1(input.resourceId);
    } catch {
        return { ok: false, error: "invalid_resource" };
    }
    if (!input.resourceId.trim() || !input.displayName.trim()) return { ok: false, error: "invalid_resource" };
    if (input.resourceId.length > 256 || input.displayName.trim().length > 100) return { ok: false, error: "invalid_resource" };
    if (!["apiKey", "token", "password", "other"].includes(input.kind)) return { ok: false, error: "invalid_resource" };
    if (input.encryptionMode === "plain" && input.storedContent.t !== "plain") return { ok: false, error: "invalid_resource" };
    if (input.encryptionMode === "e2ee" && input.storedContent.t !== "encrypted") return { ok: false, error: "invalid_resource" };
    if (input.storedContent.t === "plain"
        && (input.storedContent.v.name !== input.displayName.trim() || input.storedContent.v.kind !== input.kind)) {
        return { ok: false, error: "invalid_resource" };
    }
    const owner = await tx.account.findUnique({ where: { id: input.accountId }, select: { id: true, encryptionMode: true } });
    if (!owner) return { ok: false, error: "resource_not_found" };
    if (input.encryptionMode === "e2ee" && owner.encryptionMode !== "e2ee") return { ok: false, error: "recipient_mode_unsupported" };
    if (input.encryptionMode === "e2ee"
        && !(input.keyEnvelopes ?? []).some((envelope) => envelope.recipientAccountId === input.accountId)) {
        return { ok: false, error: "invalid_resource" };
    }
    if (input.encryptionMode === "plain" && (input.keyEnvelopes?.length ?? 0) > 0) {
        return { ok: false, error: "invalid_resource" };
    }
    const recipients = [...new Set(input.accountGrants ?? [])].filter((accountId) => accountId !== input.accountId);
    const teams = [...new Set(input.teamGrants ?? [])];
    const groups = [...new Set(input.groupGrants ?? [])];
    const requestedEnvelopes = input.keyEnvelopes ?? [];
    const existing = await tx.savedSecretResource.findUnique({
        where: { id: input.resourceId },
        select: {
            ownerAccountId: true,
            revision: true,
            displayName: true,
            kind: true,
            encryptionMode: true,
            storedContent: true,
            accountGrants: { select: { accountId: true } },
            teamGrants: { select: { teamId: true } },
            groupGrants: { select: { teamGroupId: true } },
            keyEnvelopes: {
                select: {
                    recipientAccountId: true,
                    encryptedDataKey: true,
                    recipientContentPublicKeyFingerprint: true,
                },
            },
        },
    });
    if (existing) {
        const existingEnvelopesByRecipient = new Map(existing.keyEnvelopes.map((envelope) => [
            envelope.recipientAccountId,
            envelope,
        ]));
        const isExactRetry = existing.ownerAccountId === input.accountId
            && existing.displayName === input.displayName.trim()
            && existing.kind === input.kind
            && existing.encryptionMode === input.encryptionMode
            && isDeepStrictEqual(readStoredContent(input.resourceId, existing.storedContent), input.storedContent)
            && hasSameStringSet(existing.accountGrants.map((grant) => grant.accountId), recipients)
            && hasSameStringSet(existing.teamGrants.map((grant) => grant.teamId), teams)
            && hasSameStringSet(existing.groupGrants.map((grant) => grant.teamGroupId), groups)
            && existing.keyEnvelopes.length === requestedEnvelopes.length
            && requestedEnvelopes.every((requested) => {
                const persisted = existingEnvelopesByRecipient.get(requested.recipientAccountId);
                return persisted !== undefined
                    && persisted.recipientContentPublicKeyFingerprint === requested.recipientContentPublicKeyFingerprint
                    && isDeepStrictEqual(new Uint8Array(persisted.encryptedDataKey), requested.encryptedDataKey);
            });
        return isExactRetry
            ? { ok: true, value: { resourceId: input.resourceId, revision: existing.revision } }
            : { ok: false, error: "resource_changed" };
    }
    const envelopeRecipients = [...new Set(
        requestedEnvelopes.map((envelope) => envelope.recipientAccountId),
    )];
    if (!await isSavedSecretAudienceEligibleInTx(tx, {
        ownerAccountId: input.accountId,
        accountIds: recipients.filter((accountId) => accountId !== input.accountId),
        teamIds: teams,
        groupIds: groups,
        ...(input.authentication ? { authentication: input.authentication } : {}),
    })) {
        return { ok: false, error: "forbidden" };
    }
    const requestedAccountIds = [...new Set([...recipients, ...envelopeRecipients])];
    const [teamMembers, groupMembers, recipientCount, teamCount, groupCount] = await Promise.all([
        teams.length === 0 ? [] : tx.teamMembership.findMany({
            where: { teamId: { in: teams }, status: "active", account: { status: "active" }, team: { archivedAt: null } },
            select: { accountId: true, role: true },
        }),
        groups.length === 0 ? [] : tx.teamGroupMembership.findMany({
            where: {
                teamGroupId: { in: groups },
                group: { archivedAt: null, team: { archivedAt: null } },
                teamMembership: { status: "active", account: { status: "active" } },
            },
            select: { teamMembership: { select: { accountId: true } } },
        }),
        requestedAccountIds.length === 0 ? 0 : tx.account.count({ where: { id: { in: requestedAccountIds } } }),
        teams.length === 0 ? 0 : tx.team.count({ where: { id: { in: teams }, archivedAt: null } }),
        groups.length === 0 ? 0 : tx.teamGroup.count({ where: { id: { in: groups }, archivedAt: null, team: { archivedAt: null } } }),
    ]);
    const teamRecipientIds = teamMembers
        .filter((member) => isTeamPrincipalRoleV1(member.role))
        .map((member) => member.accountId);
    const recipientIds = [...new Set([
        ...recipients,
        ...teamRecipientIds,
        ...groupMembers.map((member) => member.teamMembership.accountId),
        ...envelopeRecipients,
    ])];
    if (recipientCount !== requestedAccountIds.length || teamCount !== teams.length || groupCount !== groups.length) {
        return { ok: false, error: "invalid_resource" };
    }
    if (input.encryptionMode === "e2ee") {
        const recipientRows = recipientIds.length === 0
            ? []
            : await tx.account.findMany({
                where: { id: { in: recipientIds } },
                select: {
                    id: true,
                    publicKey: true,
                    encryptionMode: true,
                    contentPublicKey: true,
                    contentPublicKeySig: true,
                },
            });
        const authorizedRecipientIds = new Set([input.accountId, ...recipients, ...teamRecipientIds, ...groupMembers.map((member) => member.teamMembership.accountId)]);
        if (envelopeRecipients.some((accountId) => !authorizedRecipientIds.has(accountId))) {
            return { ok: false, error: "invalid_resource" };
        }
        const recipientRowsById = new Map(recipientRows.map((account) => [account.id, account]));
        const envelopes = requestedEnvelopes;
        if (new Set(envelopes.map((envelope) => envelope.recipientAccountId)).size !== envelopes.length) {
            return { ok: false, error: "invalid_resource" };
        }
        for (const envelope of envelopes) {
            const recipient = recipientRowsById.get(envelope.recipientAccountId);
            if (!recipient) return { ok: false, error: "invalid_resource" };
            const readiness = deriveAccountRecipientEnvelopeReadinessFromRow(recipient);
            if (readiness.status !== "available"
                || readiness.binding.contentPublicKeyFingerprint !== envelope.recipientContentPublicKeyFingerprint
                || parseEncryptedDataKeyEnvelopeV1(envelope.encryptedDataKey) === null) {
                return { ok: false, error: "invalid_resource" };
            }
        }
    }
    const resource = await tx.savedSecretResource.create({
        data: {
            id: input.resourceId,
            ownerAccountId: input.accountId,
            displayName: input.displayName.trim(),
            kind: input.kind,
            encryptionMode: input.encryptionMode,
            storedContent: storeContent(input.resourceId, input.storedContent),
            accountGrants: recipients.length ? { create: recipients.map((accountId) => ({ accountId, createdByAccountId: input.accountId })) } : undefined,
            teamGrants: teams.length ? { create: teams.map((teamId) => ({ teamId, createdByAccountId: input.accountId })) } : undefined,
            groupGrants: groups.length ? { create: groups.map((teamGroupId) => ({ teamGroupId, createdByAccountId: input.accountId })) } : undefined,
            keyEnvelopes: requestedEnvelopes.length ? {
                createMany: {
                    data: requestedEnvelopes.map((envelope) => ({
                        recipientAccountId: envelope.recipientAccountId,
                        encryptedDataKey: copyBytes(envelope.encryptedDataKey),
                        recipientContentPublicKeyFingerprint: envelope.recipientContentPublicKeyFingerprint,
                    })),
                },
            } : undefined,
        },
        select: { id: true, revision: true },
    });
    await markResourceChangedForAccounts(tx, input.resourceId, resource.revision, [input.accountId, ...recipientIds]);
    return { ok: true, value: { resourceId: resource.id, revision: resource.revision } };
}

export type PromoteSavedSecretResourceInput = CreateSavedSecretResourceInput & Readonly<{
    expectedSettingsVersion: number;
    nextSettings: AccountSettingsStoredContentEnvelope | null;
}>;

export type SetSavedSecretResourceGrantsInput = Readonly<{
    accountId: string;
    authentication?: TeamOperationAuthenticationContext;
    resourceId: string;
    expectedRevision: number;
    accountGrants: readonly string[];
    teamGrants: readonly string[];
    groupGrants: readonly string[];
    keyEnvelopes?: readonly Readonly<{
        recipientAccountId: string;
        encryptedDataKey: Uint8Array;
        recipientContentPublicKeyFingerprint: string;
    }>[];
}>;

export async function setSavedSecretResourceGrantsInTx(
    tx: Tx,
    input: SetSavedSecretResourceGrantsInput,
): Promise<SavedSecretResourceServiceResult<{ resourceId: string; revision: number }>> {
    const existing = await tx.savedSecretResource.findUnique({
        where: { id: input.resourceId },
        select: { ownerAccountId: true, revision: true, encryptionMode: true },
    });
    if (!existing) return { ok: false, error: "resource_not_found" };
    if (existing.ownerAccountId !== input.accountId) return { ok: false, error: "forbidden" };
    if (existing.revision !== input.expectedRevision) return { ok: false, error: "resource_changed" };

    const accountIds = [...new Set(input.accountGrants)].filter((id) => id !== input.accountId);
    const teamIds = [...new Set(input.teamGrants)];
    const groupIds = [...new Set(input.groupGrants)];
    if (!await isSavedSecretAudienceEligibleInTx(tx, {
        ownerAccountId: input.accountId,
        accountIds,
        teamIds,
        groupIds,
        ...(input.authentication ? { authentication: input.authentication } : {}),
    })) return { ok: false, error: "forbidden" };

    const [before, after] = await Promise.all([
        listAuthorizedAccountIdsForResourceInTx(tx, input.resourceId),
        resolveSavedSecretAudienceAccountIdsInTx(tx, {
            ownerAccountId: input.accountId,
            accountIds,
            teamIds,
            groupIds,
        }),
    ]);
    const envelopes = input.keyEnvelopes ?? [];
    if (existing.encryptionMode === "plain" && envelopes.length > 0) {
        return { ok: false, error: "invalid_resource" };
    }
    if (existing.encryptionMode === "e2ee") {
        if (new Set(envelopes.map((envelope) => envelope.recipientAccountId)).size !== envelopes.length) {
            return { ok: false, error: "invalid_resource" };
        }
        const afterSet = new Set(after);
        if (envelopes.some((envelope) => !afterSet.has(envelope.recipientAccountId))) {
            return { ok: false, error: "invalid_resource" };
        }
        const recipientRows = envelopes.length === 0 ? [] : await tx.account.findMany({
            where: { id: { in: envelopes.map((envelope) => envelope.recipientAccountId) } },
            select: {
                id: true,
                publicKey: true,
                encryptionMode: true,
                contentPublicKey: true,
                contentPublicKeySig: true,
            },
        });
        const recipientRowsById = new Map(recipientRows.map((account) => [account.id, account]));
        for (const envelope of envelopes) {
            const recipient = recipientRowsById.get(envelope.recipientAccountId);
            if (!recipient) return { ok: false, error: "invalid_resource" };
            const readiness = deriveAccountRecipientEnvelopeReadinessFromRow(recipient);
            if (readiness.status !== "available"
                || readiness.binding.contentPublicKeyFingerprint !== envelope.recipientContentPublicKeyFingerprint
                || parseEncryptedDataKeyEnvelopeV1(envelope.encryptedDataKey) === null) {
                return { ok: false, error: "invalid_resource" };
            }
        }
    }
    const updated = await tx.savedSecretResource.updateMany({
        where: {
            id: input.resourceId,
            ownerAccountId: input.accountId,
            revision: input.expectedRevision,
        },
        data: { revision: { increment: 1 } },
    });
    if (updated.count !== 1) return { ok: false, error: "resource_changed" };

    await Promise.all([
        tx.savedSecretAccountGrant.deleteMany({ where: { resourceId: input.resourceId } }),
        tx.savedSecretTeamGrant.deleteMany({ where: { resourceId: input.resourceId } }),
        tx.savedSecretGroupGrant.deleteMany({ where: { resourceId: input.resourceId } }),
        tx.savedSecretResourceKeyEnvelope.deleteMany({
            where: { resourceId: input.resourceId, recipientAccountId: { notIn: [...after] } },
        }),
    ]);
    if (accountIds.length > 0) await tx.savedSecretAccountGrant.createMany({
        data: accountIds.map((accountId) => ({
            resourceId: input.resourceId,
            accountId,
            createdByAccountId: input.accountId,
        })),
    });
    if (teamIds.length > 0) await tx.savedSecretTeamGrant.createMany({
        data: teamIds.map((teamId) => ({
            resourceId: input.resourceId,
            teamId,
            createdByAccountId: input.accountId,
        })),
    });
    if (groupIds.length > 0) await tx.savedSecretGroupGrant.createMany({
        data: groupIds.map((teamGroupId) => ({
            resourceId: input.resourceId,
            teamGroupId,
            createdByAccountId: input.accountId,
        })),
    });
    for (const envelope of envelopes) {
        await tx.savedSecretResourceKeyEnvelope.upsert({
            where: {
                resourceId_recipientAccountId: {
                    resourceId: input.resourceId,
                    recipientAccountId: envelope.recipientAccountId,
                },
            },
            create: {
                resourceId: input.resourceId,
                recipientAccountId: envelope.recipientAccountId,
                encryptedDataKey: copyBytes(envelope.encryptedDataKey),
                recipientContentPublicKeyFingerprint: envelope.recipientContentPublicKeyFingerprint,
            },
            update: {
                encryptedDataKey: copyBytes(envelope.encryptedDataKey),
                recipientContentPublicKeyFingerprint: envelope.recipientContentPublicKeyFingerprint,
            },
        });
    }
    await markResourceChangedForAccounts(
        tx,
        input.resourceId,
        input.expectedRevision + 1,
        [...new Set([...before, ...after])],
    );
    return { ok: true, value: { resourceId: input.resourceId, revision: input.expectedRevision + 1 } };
}

export async function repairSavedSecretResourceKeyEnvelopesInTx(
    tx: Tx,
    input: Readonly<{
        accountId: string;
        resourceId: string;
        expectedRevision: number;
        keyEnvelopes: readonly Readonly<{
            recipientAccountId: string;
            encryptedDataKey: Uint8Array;
            recipientContentPublicKeyFingerprint: string;
        }>[];
    }>,
): Promise<SavedSecretResourceServiceResult<{ resourceId: string; revision: number }>> {
    const resource = await tx.savedSecretResource.findUnique({
        where: { id: input.resourceId },
        select: { ownerAccountId: true, encryptionMode: true, revision: true },
    });
    if (!resource) return { ok: false, error: "resource_not_found" };
    if (resource.ownerAccountId !== input.accountId) return { ok: false, error: "forbidden" };
    if (resource.revision !== input.expectedRevision) return { ok: false, error: "resource_changed" };
    if (resource.encryptionMode !== "e2ee" || input.keyEnvelopes.length === 0) {
        return { ok: false, error: "invalid_resource" };
    }
    // Acquire the resource-row write lock without advancing the content/audience
    // revision. Concurrent grant/update/delete transactions serialize here, so
    // the eligibility and key checks below belong to this exact revision.
    const current = await tx.savedSecretResource.updateMany({
        where: {
            id: input.resourceId,
            ownerAccountId: input.accountId,
            revision: input.expectedRevision,
            encryptionMode: "e2ee",
        },
        data: { revision: input.expectedRevision },
    });
    if (current.count !== 1) return { ok: false, error: "resource_changed" };
    const recipientIds = input.keyEnvelopes.map((envelope) => envelope.recipientAccountId);
    if (new Set(recipientIds).size !== recipientIds.length) return { ok: false, error: "invalid_resource" };
    const authorizedIds = new Set(await listAuthorizedAccountIdsForResourceInTx(tx, input.resourceId));
    if (recipientIds.some((accountId) => !authorizedIds.has(accountId))) {
        return { ok: false, error: "recipient_changed" };
    }
    const recipients = await tx.account.findMany({
        where: { id: { in: recipientIds }, status: "active" },
        select: {
            id: true,
            publicKey: true,
            encryptionMode: true,
            contentPublicKey: true,
            contentPublicKeySig: true,
        },
    });
    const recipientsById = new Map(recipients.map((recipient) => [recipient.id, recipient]));
    for (const envelope of input.keyEnvelopes) {
        const recipient = recipientsById.get(envelope.recipientAccountId);
        if (!recipient) return { ok: false, error: "recipient_changed" };
        const readiness = deriveAccountRecipientEnvelopeReadinessFromRow(recipient);
        if (readiness.status !== "available") return { ok: false, error: "recipient_key_unavailable" };
        if (readiness.binding.contentPublicKeyFingerprint !== envelope.recipientContentPublicKeyFingerprint) {
            return { ok: false, error: "recipient_changed" };
        }
        if (parseEncryptedDataKeyEnvelopeV1(envelope.encryptedDataKey) === null) {
            return { ok: false, error: "invalid_resource" };
        }
    }
    for (const envelope of input.keyEnvelopes) {
        await tx.savedSecretResourceKeyEnvelope.upsert({
            where: {
                resourceId_recipientAccountId: {
                    resourceId: input.resourceId,
                    recipientAccountId: envelope.recipientAccountId,
                },
            },
            create: {
                resourceId: input.resourceId,
                recipientAccountId: envelope.recipientAccountId,
                encryptedDataKey: copyBytes(envelope.encryptedDataKey),
                recipientContentPublicKeyFingerprint: envelope.recipientContentPublicKeyFingerprint,
            },
            update: {
                encryptedDataKey: copyBytes(envelope.encryptedDataKey),
                recipientContentPublicKeyFingerprint: envelope.recipientContentPublicKeyFingerprint,
            },
        });
    }
    await markResourceChangedForAccounts(tx, input.resourceId, resource.revision, [input.accountId, ...recipientIds]);
    return { ok: true, value: { resourceId: input.resourceId, revision: resource.revision } };
}

export type UpdateSavedSecretResourceInput = Readonly<{
    accountId: string;
    resourceId: string;
    expectedRevision: number;
    displayName: string;
    kind: "apiKey" | "token" | "password" | "other";
    storedContent: SavedSecretResourceStoredContentV1;
}>;

export async function updateSavedSecretResourceInTx(
    tx: Tx,
    input: UpdateSavedSecretResourceInput,
): Promise<SavedSecretResourceServiceResult<{ resourceId: string; revision: number }>> {
    const resource = await tx.savedSecretResource.findUnique({
        where: { id: input.resourceId },
        select: { ownerAccountId: true, encryptionMode: true, revision: true },
    });
    if (!resource) return { ok: false, error: "resource_not_found" };
    if (resource.ownerAccountId !== input.accountId) return { ok: false, error: "forbidden" };
    if (resource.revision !== input.expectedRevision) return { ok: false, error: "resource_changed" };
    if ((resource.encryptionMode === "plain" && input.storedContent.t !== "plain")
        || (resource.encryptionMode === "e2ee" && input.storedContent.t !== "encrypted")) {
        return { ok: false, error: "invalid_resource" };
    }
    if (input.storedContent.t === "plain"
        && (input.storedContent.v.name !== input.displayName.trim() || input.storedContent.v.kind !== input.kind)) {
        return { ok: false, error: "invalid_resource" };
    }
    const authorizedAccountIds = await listAuthorizedAccountIdsForResourceInTx(tx, input.resourceId);
    const updated = await tx.savedSecretResource.updateMany({
        where: { id: input.resourceId, ownerAccountId: input.accountId, revision: input.expectedRevision },
        data: {
            displayName: input.displayName.trim(),
            kind: input.kind,
            storedContent: storeContent(input.resourceId, input.storedContent),
            revision: { increment: 1 },
        },
    });
    if (updated.count !== 1) return { ok: false, error: "resource_changed" };
    await markResourceChangedForAccounts(tx, input.resourceId, input.expectedRevision + 1, authorizedAccountIds);
    return { ok: true, value: { resourceId: input.resourceId, revision: input.expectedRevision + 1 } };
}

export async function deleteSavedSecretResourceInTx(
    tx: Tx,
    input: Readonly<{ accountId: string; resourceId: string; expectedRevision: number }>,
): Promise<SavedSecretResourceServiceResult<{ resourceId: string }>> {
    const existing = await tx.savedSecretResource.findUnique({
        where: { id: input.resourceId },
        select: { ownerAccountId: true, revision: true },
    });
    if (!existing) return { ok: false, error: "resource_not_found" };
    if (existing.ownerAccountId !== input.accountId) return { ok: false, error: "forbidden" };
    if (existing.revision !== input.expectedRevision) return { ok: false, error: "resource_changed" };
    const authorizedAccountIds = await listAuthorizedAccountIdsForResourceInTx(tx, input.resourceId);
    const deleted = await tx.savedSecretResource.deleteMany({
        where: { id: input.resourceId, ownerAccountId: input.accountId, revision: input.expectedRevision },
    });
    if (deleted.count !== 1) return { ok: false, error: "resource_changed" };
    await markResourceChangedForAccounts(tx, input.resourceId, input.expectedRevision + 1, authorizedAccountIds);
    return { ok: true, value: { resourceId: input.resourceId } };
}

/** Couples resource creation with the canonical Account Settings CAS writer. */
export async function promoteSavedSecretResourceInTx(
    tx: Tx,
    input: PromoteSavedSecretResourceInput,
): Promise<SavedSecretResourceServiceResult<{ resourceId: string; settingsVersion: number }>> {
    const created = await createSavedSecretResourceInTx(tx, input);
    if (!created.ok) return created;
    const settingsWrite = await writeAccountSettingsInTx({
        tx,
        accountId: input.accountId,
        expectedVersion: input.expectedSettingsVersion,
        next: { kind: "v2", content: input.nextSettings },
    });
    if (settingsWrite.status === "version_mismatch") {
        // Creation is idempotent only for an exact resource request. When the
        // Settings CAS is exactly one revision ahead with the requested bytes,
        // this transaction is a retry whose original committed response was
        // lost; do not create another settings revision or mutable source.
        if (settingsWrite.currentVersion === input.expectedSettingsVersion + 1
            && isDeepStrictEqual(settingsWrite.currentContent, input.nextSettings)) {
            return {
                ok: true,
                value: {
                    resourceId: created.value.resourceId,
                    settingsVersion: settingsWrite.currentVersion,
                },
            };
        }
        throw new SavedSecretResourceTransactionAbort("settings_conflict");
    }
    if (settingsWrite.status !== "success") {
        throw new SavedSecretResourceTransactionAbort("settings_invalid");
    }
    return { ok: true, value: { resourceId: created.value.resourceId, settingsVersion: settingsWrite.version } };
}
