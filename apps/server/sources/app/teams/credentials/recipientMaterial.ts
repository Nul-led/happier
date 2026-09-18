import {
    computeTeamCredentialSourceMemberKeyV1,
    parseTeamCredentialDirectMaterialStoredV1,
    TeamCredentialSourceBindingV1Schema,
    type TeamCredentialDirectMaterialUseV1,
    type TeamCredentialDirectMaterialStoredV1,
} from "@happier-dev/protocol/teams";

import { deriveAccountEncryptionCurrentnessFromRow } from "@/app/encryption/accountContentKeyAdmission";
import type { Tx } from "@/storage/inTx";
import { resolveTeamActorContextInTx, type TeamOperationAuthenticationContext } from "../actorContext";
import { resolveTeamCredentialEntitlementInTx } from "./resourceAccess";
import { qualifyTeamCredentialOperationInTx } from "./resourceRead";
import {
    parsePublishedTeamCredentialSourceVersions,
    listTeamCredentialDirectSourceMembersInTx,
    resolveTeamCredentialDirectSourceCurrentnessInTx,
    resolveTeamCredentialResourceSourceInTx,
} from "./resourceSourceResolver";
import { matchesTeamCredentialRecipientBinding } from "./recipientMaterialCurrentness";
import { recordTeamCredentialDirectDeliveryActivityInTx } from "./resourceActivity";
import {
    admitSessionTeamCredentialBindingInTx,
    validatePlannedSessionTeamCredentialResourceInTx,
} from "./sessionBinding";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";

type RecipientMode = "plain" | "e2ee";

export type TeamCredentialRecipientMaterialReadResult =
    | Readonly<{ ok: true; resourceId: string; sourceMemberKey: string; sourceVersion: string; recipientMode: RecipientMode; stored: TeamCredentialDirectMaterialStoredV1 }>
    | Readonly<{ ok: false; reason: "access_removed" | "disabled" | "preparing" | "source_changed" | "recipient_mode_mismatch" | "resource_corrupt" }>;

export type TeamCredentialRecipientMaterialUpsertResult =
    | Readonly<{ ok: true; resourceId: string; recipientAccountId: string; sourceMemberKey: string; sourceVersion: string }>
    | Readonly<{ ok: false; reason: "resource_not_found" | "source_owner_required" | "access_removed" | "disabled" | "invalid_material" | "resource_corrupt" | "resource_changed" | "source_changed" | "recipient_binding_changed" | "material_changed" | "team_authentication_required" | "team_authentication_policy_unavailable" }>;

function encodeStoredMaterial(stored: TeamCredentialDirectMaterialStoredV1): Buffer {
    return Buffer.from(new TextEncoder().encode(JSON.stringify(stored)));
}

async function qualifyCurrentTeamCredentialSourceCustodianInTx(
    tx: Tx,
    input: Readonly<{
        teamId: string;
        actorAccountId: string;
        authentication?: TeamOperationAuthenticationContext;
    }>,
) {
    const actor = await resolveTeamActorContextInTx(tx, {
        teamId: input.teamId,
        actorAccountId: input.actorAccountId,
    });
    if (!actor?.teamCapabilities.viewTeam) {
        return { ok: false as const, reason: "source_owner_required" as const };
    }
    const qualification = await qualifyTeamCredentialOperationInTx(
        tx,
        actor,
        input.authentication ?? { authenticationAuthority: "present_user" },
    );
    return qualification.ok
        ? { ok: true as const }
        : { ok: false as const, reason: qualification.error };
}

/**
 * Enumerates source members internally and merges their per-recipient state
 * without disclosing source keys or material to the Access surface.
 */
export async function readTeamCredentialDirectMaterialCensusInTx(
    tx: Tx,
    input: Readonly<{
        actorAccountId: string;
        teamId: string;
        resourceId: string;
        cursor: string | null;
        authentication?: TeamOperationAuthenticationContext;
    }>,
) {
    const resource = await tx.teamCredentialResource.findUnique({
        where: { id: input.resourceId },
        select: {
            id: true,
            teamId: true,
            custodianAccountId: true,
            enabled: true,
            revision: true,
            sourceBindingJson: true,
            directSourceVersionsJson: true,
        },
    });
    if (!resource || resource.teamId !== input.teamId) return { ok: false as const, reason: "resource_not_found" as const };
    if (resource.custodianAccountId !== input.actorAccountId) return { ok: false as const, reason: "source_owner_required" as const };
    const qualification = await qualifyCurrentTeamCredentialSourceCustodianInTx(tx, input);
    if (!qualification.ok) return qualification;
    if (!resource.enabled) return { ok: false as const, reason: "disabled" as const };
    const source = parseResourceSource(resource.sourceBindingJson);
    const published = parsePublishedTeamCredentialSourceVersions(resource.directSourceVersionsJson);
    if (!source || !published) return { ok: false as const, reason: "resource_corrupt" as const };
    const members = await listTeamCredentialDirectSourceMembersInTx(tx, {
        custodianAccountId: resource.custodianAccountId,
        source,
    });
    if (!members) return { ok: false as const, reason: "source_changed" as const };
    const membershipRows = await tx.teamMembership.findMany({
        where: { teamId: resource.teamId },
        orderBy: { id: "asc" },
        take: 101,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
            id: true,
            accountId: true,
            account: { select: { publicKey: true, encryptionMode: true, contentPublicKey: true, contentPublicKeySig: true } },
        },
    });
    const page = membershipRows.slice(0, 100);
    const memberKeys = members.map(computeTeamCredentialSourceMemberKeyV1);
    const currentSourceVersions = new Map<string, string | null>();
    for (const memberKey of memberKeys) {
        const currentness = await resolveTeamCredentialDirectSourceCurrentnessInTx(tx, {
            custodianAccountId: resource.custodianAccountId,
            source,
            sourceMemberKey: memberKey,
        });
        if (currentness.status !== "current") continue;
        currentSourceVersions.set(memberKey, currentness.sourceVersion);
    }
    const rows = memberKeys.length === 0 ? [] : await tx.teamCredentialRecipientMaterial.findMany({
        where: {
            resourceId: resource.id,
            recipientAccountId: { in: page.map(row => row.accountId) },
            sourceMemberKey: { in: memberKeys },
        },
        select: {
            recipientAccountId: true,
            sourceMemberKey: true,
            sourceVersion: true,
            recipientMode: true,
            recipientContentPublicKeyFingerprint: true,
        },
    });
    const recipients = [];
    for (const membership of page) {
        const entitlement = await resolveTeamCredentialEntitlementInTx(tx, {
            resourceId: resource.id,
            accountId: membership.accountId,
        });
        if (!entitlement.ok || !entitlement.mayReceiveDirect) continue;
        const encryption = deriveAccountEncryptionCurrentnessFromRow(membership.account);
        if (encryption.status !== "ready") {
            recipients.push({ recipientAccountId: membership.accountId, readiness: "recipient_binding_changed" as const });
            continue;
        }
        const ready = memberKeys.length > 0 && memberKeys.every(memberKey => rows.some(row => (
            row.recipientAccountId === membership.accountId
            && row.sourceMemberKey === memberKey
            && row.sourceVersion === published[memberKey]
            && (currentSourceVersions.get(memberKey) === null
                || row.sourceVersion === currentSourceVersions.get(memberKey))
            && matchesTeamCredentialRecipientBinding(row, encryption.currentness)
        )));
        recipients.push({
            recipientAccountId: membership.accountId,
            readiness: ready ? "ready" as const : "preparing" as const,
        });
    }
    return {
        ok: true as const,
        resourceRevision: resource.revision,
        sourceOwner: true as const,
        recipients,
        nextCursor: membershipRows.length > 100 ? page.at(-1)?.id ?? null : null,
    };
}

function prismaBytes(value: Buffer): Uint8Array<ArrayBuffer> {
    return value as unknown as Uint8Array<ArrayBuffer>;
}

function decodeStoredMaterial(value: Uint8Array): TeamCredentialDirectMaterialStoredV1 | null {
    try {
        return parseTeamCredentialDirectMaterialStoredV1(JSON.parse(new TextDecoder().decode(value)));
    } catch {
        return null;
    }
}

function isModeCompatible(mode: RecipientMode, stored: TeamCredentialDirectMaterialStoredV1): boolean {
    return mode === "plain" ? stored.t === "plain" : stored.t === "encrypted";
}

function parseResourceSource(sourceBindingJson: string) {
    try {
        const parsed = TeamCredentialSourceBindingV1Schema.safeParse(JSON.parse(sourceBindingJson));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export async function prepareTeamCredentialRecipientMaterialInTx(
    tx: Tx,
    input: Readonly<{
        actorAccountId: string;
        teamId: string;
        resourceId: string;
        sourceMemberKey: string;
        cursor: string | null;
        authentication?: TeamOperationAuthenticationContext;
    }>,
) {
    const resource = await tx.teamCredentialResource.findUnique({
        where: { id: input.resourceId },
        select: {
            id: true, teamId: true, custodianAccountId: true, enabled: true, revision: true, sourceBindingJson: true,
            directSourceVersionsJson: true,
        },
    });
    if (!resource || resource.teamId !== input.teamId) return { ok: false as const, reason: "resource_not_found" as const };
    if (resource.custodianAccountId !== input.actorAccountId) return { ok: false as const, reason: "source_owner_required" as const };
    const qualification = await qualifyCurrentTeamCredentialSourceCustodianInTx(tx, input);
    if (!qualification.ok) return qualification;
    if (!resource.enabled) return { ok: false as const, reason: "disabled" as const };
    const source = parseResourceSource(resource.sourceBindingJson);
    if (!source) return { ok: false as const, reason: "resource_corrupt" as const };
    const sourceResolution = await resolveTeamCredentialResourceSourceInTx(tx, {
        custodianAccountId: resource.custodianAccountId,
        source,
    });
    if (sourceResolution.status !== "current") {
        return { ok: false as const, reason: sourceResolution.reason === "invalid_source_binding" ? "resource_corrupt" as const : "source_changed" as const };
    }
    const sourceCurrentness = await resolveTeamCredentialDirectSourceCurrentnessInTx(tx, {
        custodianAccountId: resource.custodianAccountId,
        source,
        sourceMemberKey: input.sourceMemberKey,
    });
    if (sourceCurrentness.status !== "current") {
        return { ok: false as const, reason: "source_changed" as const };
    }
    const publishedSourceVersions = parsePublishedTeamCredentialSourceVersions(resource.directSourceVersionsJson);
    if (!publishedSourceVersions) return { ok: false as const, reason: "resource_corrupt" as const };

    const membershipRows = await tx.teamMembership.findMany({
        where: { teamId: resource.teamId },
        orderBy: { id: "asc" },
        take: 101,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        select: {
            id: true,
            accountId: true,
            account: {
                select: { publicKey: true, encryptionMode: true, contentPublicKey: true, contentPublicKeySig: true },
            },
        },
    });
    const page = membershipRows.slice(0, 100);
    const materials = await tx.teamCredentialRecipientMaterial.findMany({
        where: {
            resourceId: resource.id,
            sourceMemberKey: input.sourceMemberKey,
            recipientAccountId: { in: page.map(row => row.accountId) },
        },
        select: { recipientAccountId: true, sourceVersion: true },
    });
    const existingByRecipient = new Map(materials.map(row => [row.recipientAccountId, row.sourceVersion]));
    const recipients = [];
    for (const row of page) {
        const entitlement = await resolveTeamCredentialEntitlementInTx(tx, {
            resourceId: resource.id,
            accountId: row.accountId,
        });
        if (!entitlement.ok || !entitlement.mayReceiveDirect) continue;
        const encryption = deriveAccountEncryptionCurrentnessFromRow(row.account);
        if (encryption.status !== "ready") continue;
        recipients.push({
            recipientAccountId: row.accountId,
            recipientMode: encryption.currentness.encryptionMode,
            recipientContentPublicKeyFingerprint: encryption.currentness.contentPublicKeyFingerprint,
            recipientContentPublicKey: encryption.currentness.contentPublicKey === null
                ? null
                : Buffer.from(encryption.currentness.contentPublicKey).toString("base64"),
            expectedStoredSourceVersion: existingByRecipient.get(row.accountId) ?? null,
        });
    }
    return {
        ok: true as const,
        teamId: resource.teamId,
        resourceId: resource.id,
        resourceRevision: resource.revision,
        source,
        sourceMember: sourceCurrentness.sourceMember,
        sourceCredentialIncarnation: sourceCurrentness.sourceCredentialIncarnation,
        publishedSourceVersion: publishedSourceVersions[input.sourceMemberKey] ?? null,
        recipients,
        nextCursor: membershipRows.length > 100 ? page.at(-1)?.id ?? null : null,
    };
}

/**
 * Reads one recipient projection only after rechecking the current grant.
 * Stored bytes are never an authority: revocation and delivery-mode changes
 * therefore take effect even if asynchronous cleanup has not run yet.
 */
export async function readTeamCredentialRecipientMaterialInTx(
    tx: Tx,
    input: Readonly<{
        resourceId: string;
        recipientAccountId: string;
        sourceMemberKey: string;
        expectedSourceVersion: string;
        recipientMode: RecipientMode;
        expectedRecipientContentPublicKeyFingerprint: string | null;
    }>,
): Promise<TeamCredentialRecipientMaterialReadResult> {
    const resource = await tx.teamCredentialResource.findUnique({
        where: { id: input.resourceId },
        select: { custodianAccountId: true, enabled: true, sourceBindingJson: true },
    });
    if (!resource) return { ok: false, reason: "access_removed" };
    if (!resource.enabled) return { ok: false, reason: "disabled" };
    const source = parseResourceSource(resource.sourceBindingJson);
    if (!source) return { ok: false, reason: "resource_corrupt" };
    const sourceCurrentness = await resolveTeamCredentialDirectSourceCurrentnessInTx(tx, {
        custodianAccountId: resource.custodianAccountId,
        source,
        sourceMemberKey: input.sourceMemberKey,
    });
    if (sourceCurrentness.status !== "current") return { ok: false, reason: "source_changed" };
    if (sourceCurrentness.sourceVersion !== null
        && input.expectedSourceVersion !== sourceCurrentness.sourceVersion) {
        return { ok: false, reason: "source_changed" };
    }
    const entitlement = await resolveTeamCredentialEntitlementInTx(tx, {
        resourceId: input.resourceId,
        accountId: input.recipientAccountId,
    });
    if (!entitlement.ok) {
        return entitlement.reason === "resource_corrupt"
            ? { ok: false, reason: "resource_corrupt" }
            : entitlement.reason === "disabled"
                ? { ok: false, reason: "disabled" }
                : { ok: false, reason: "access_removed" };
    }
    if (!entitlement.mayReceiveDirect) return { ok: false, reason: "access_removed" };
    const recipient = await tx.account.findUnique({
        where: { id: input.recipientAccountId },
        select: { publicKey: true, encryptionMode: true, contentPublicKey: true, contentPublicKeySig: true },
    });
    if (!recipient) {
        return { ok: false, reason: "resource_corrupt" };
    }
    const recipientCurrentness = deriveAccountEncryptionCurrentnessFromRow(recipient);
    if (recipientCurrentness.status !== "ready") return { ok: false, reason: "recipient_mode_mismatch" };
    if (
        recipientCurrentness.currentness.encryptionMode !== input.recipientMode
        || recipientCurrentness.currentness.contentPublicKeyFingerprint
            !== input.expectedRecipientContentPublicKeyFingerprint
    ) {
        return { ok: false, reason: "recipient_mode_mismatch" };
    }
    const row = await tx.teamCredentialRecipientMaterial.findUnique({
        where: {
            resourceId_recipientAccountId_sourceMemberKey: {
                resourceId: input.resourceId,
                recipientAccountId: input.recipientAccountId,
                sourceMemberKey: input.sourceMemberKey,
            },
        },
        select: {
            resourceId: true,
            sourceMemberKey: true,
            sourceVersion: true,
            recipientMode: true,
            recipientContentPublicKeyFingerprint: true,
            storedMaterial: true,
        },
    });
    if (!row) return { ok: false, reason: "preparing" };
    if (row.sourceVersion !== input.expectedSourceVersion) {
        return { ok: false, reason: "source_changed" };
    }
    if (row.recipientMode !== input.recipientMode) return { ok: false, reason: "recipient_mode_mismatch" };
    if (row.recipientContentPublicKeyFingerprint !== input.expectedRecipientContentPublicKeyFingerprint) {
        return { ok: false, reason: "recipient_mode_mismatch" };
    }
    const stored = decodeStoredMaterial(row.storedMaterial);
    if (!stored || !isModeCompatible(input.recipientMode, stored)) return { ok: false, reason: "resource_corrupt" };
    return {
        ok: true,
        resourceId: row.resourceId,
        sourceMemberKey: row.sourceMemberKey,
        sourceVersion: row.sourceVersion,
        recipientMode: input.recipientMode,
        stored,
    };
}

export type CurrentTeamCredentialRecipientMaterialResult =
    | Readonly<{ ok: true; resourceId: string; resourceRevision: number; sourceMemberKey: string; sourceVersion: string; recipientMode: RecipientMode; stored: TeamCredentialDirectMaterialStoredV1; recipientContentPublicKeyFingerprint: string | null }>
    | Readonly<{ ok: false; outcome: "unavailable"; reason: "access_removed" | "disabled" | "preparing" | "source_changed" | "recipient_binding_changed" | "resource_corrupt" }>
    | Readonly<{ ok: false; outcome: "operation_error"; error: "team_authentication_required" | "team_authentication_policy_unavailable" }>;

export async function readCurrentTeamCredentialRecipientMaterialInTx(
    tx: Tx,
    input: TeamCredentialDirectMaterialUseV1 & Readonly<{
        teamId: string;
        recipientAccountId: string;
        consumer: Readonly<
            | { kind: "session"; sessionId: string }
            | { kind: "execution_run"; executionRunId: string; parentSessionId: string | null }
        >;
        sessionAuthentication: SessionAccessAuthentication;
        authentication: TeamOperationAuthenticationContext;
    }>,
): Promise<CurrentTeamCredentialRecipientMaterialResult> {
    const resource = await tx.teamCredentialResource.findUnique({
        where: { id: input.resourceId },
        select: { teamId: true, custodianAccountId: true, displayName: true, enabled: true, revision: true, sourceBindingJson: true, directSourceVersionsJson: true },
    });
    if (!resource || resource.teamId !== input.teamId) return { ok: false as const, outcome: "unavailable" as const, reason: "access_removed" as const };
    if (!resource.enabled) return { ok: false as const, outcome: "unavailable" as const, reason: "disabled" as const };
    const actor = await resolveTeamActorContextInTx(tx, {
        teamId: resource.teamId,
        actorAccountId: input.recipientAccountId,
    });
    if (!actor) return { ok: false as const, outcome: "unavailable" as const, reason: "access_removed" as const };
    // Qualify the Team operation before evaluating Session-derived access. A
    // restricted Team credential that is otherwise Session-visible must return
    // the canonical authentication result, rather than collapsing missing
    // credential evidence into a generic access-removal projection.
    const qualification = await qualifyTeamCredentialOperationInTx(tx, actor, input.authentication);
    if (!qualification.ok) return { ok: false as const, outcome: "operation_error" as const, error: qualification.error };
    const admitted = input.consumer.kind === "session" || input.consumer.parentSessionId !== null
        ? await admitSessionTeamCredentialBindingInTx(tx, {
            sessionId: input.consumer.kind === "session"
                ? input.consumer.sessionId
                : input.consumer.parentSessionId!,
            accountId: input.recipientAccountId,
            slot: input.slot,
            deliveryMode: "direct",
            authentication: input.sessionAuthentication,
        })
        : await validatePlannedSessionTeamCredentialResourceInTx(tx, {
            accountId: input.recipientAccountId,
            resourceId: input.resourceId,
            expectedResourceRevision: resource.revision,
            plannedSession: { primaryTeamId: null, teamVisibilityTeamIds: [] },
            deliveryMode: "direct",
            authentication: input.sessionAuthentication,
        });
    if (!admitted.ok || admitted.binding.resourceId !== input.resourceId) {
        return { ok: false as const, outcome: "unavailable" as const, reason: "access_removed" as const };
    }
    if (admitted.binding.resourceRevision !== resource.revision) {
        return { ok: false as const, outcome: "unavailable" as const, reason: "source_changed" as const };
    }
    const sourceMemberKey = "sourceMemberKey" in input
        ? input.sourceMemberKey
        : computeTeamCredentialSourceMemberKeyV1({
            kind: "connected_account",
            service: input.disclosedMember.service,
            connectedAccountId: input.disclosedMember.accountId,
        });
    const entitlement = await resolveTeamCredentialEntitlementInTx(tx, {
        resourceId: input.resourceId,
        accountId: input.recipientAccountId,
    });
    if (!entitlement.ok || !entitlement.mayReceiveDirect) {
        return { ok: false as const, outcome: "unavailable" as const, reason: "access_removed" as const };
    }
    const source = parseResourceSource(resource.sourceBindingJson);
    if (!source) return { ok: false as const, outcome: "unavailable" as const, reason: "resource_corrupt" as const };
    const sourceResolution = await resolveTeamCredentialResourceSourceInTx(tx, {
        custodianAccountId: resource.custodianAccountId,
        source,
    });
    if (sourceResolution.status !== "current") {
        return { ok: false as const, outcome: "unavailable" as const, reason: sourceResolution.reason === "invalid_source_binding"
            ? "resource_corrupt" as const
            : "source_changed" as const };
    }
    const sourceCurrentness = await resolveTeamCredentialDirectSourceCurrentnessInTx(tx, {
        custodianAccountId: resource.custodianAccountId,
        source,
        sourceMemberKey,
    });
    if (sourceCurrentness.status !== "current") {
        return { ok: false as const, outcome: "unavailable" as const, reason: "source_changed" as const };
    }
    const publishedSourceVersions = parsePublishedTeamCredentialSourceVersions(resource.directSourceVersionsJson);
    if (!publishedSourceVersions) return { ok: false as const, outcome: "unavailable" as const, reason: "resource_corrupt" as const };
    const publishedSourceVersion = publishedSourceVersions[sourceMemberKey] ?? null;
    if (sourceCurrentness.sourceVersion !== null
        && publishedSourceVersion !== sourceCurrentness.sourceVersion) {
        return { ok: false as const, outcome: "unavailable" as const, reason: "source_changed" as const };
    }
    const [recipient, row] = await Promise.all([
        tx.account.findUnique({
            where: { id: input.recipientAccountId },
            select: { publicKey: true, encryptionMode: true, contentPublicKey: true, contentPublicKeySig: true },
        }),
        tx.teamCredentialRecipientMaterial.findUnique({
            where: { resourceId_recipientAccountId_sourceMemberKey: {
                resourceId: input.resourceId,
                recipientAccountId: input.recipientAccountId,
                sourceMemberKey,
            } },
            select: { sourceVersion: true },
        }),
    ]);
    if (!recipient) return { ok: false as const, outcome: "unavailable" as const, reason: "resource_corrupt" as const };
    const currentness = deriveAccountEncryptionCurrentnessFromRow(recipient);
    if (currentness.status !== "ready") return { ok: false as const, outcome: "unavailable" as const, reason: "recipient_binding_changed" as const };
    if (!row) return { ok: false as const, outcome: "unavailable" as const, reason: "preparing" as const };
    if (publishedSourceVersion === null || row.sourceVersion !== publishedSourceVersion) {
        return { ok: false as const, outcome: "unavailable" as const, reason: "source_changed" as const };
    }
    const material = await readTeamCredentialRecipientMaterialInTx(tx, {
        resourceId: input.resourceId,
        recipientAccountId: input.recipientAccountId,
        sourceMemberKey,
        expectedSourceVersion: row.sourceVersion,
        recipientMode: currentness.currentness.encryptionMode,
        expectedRecipientContentPublicKeyFingerprint: currentness.currentness.contentPublicKeyFingerprint,
    });
    if (!material.ok) {
        // A recipient key/mode change racing the read is a recipient-binding
        // change at this boundary, not a distinct caller-visible vocabulary.
        return {
            ok: false as const,
            outcome: "unavailable" as const,
            reason: material.reason === "recipient_mode_mismatch" ? "recipient_binding_changed" as const : material.reason,
        };
    }
    await recordTeamCredentialDirectDeliveryActivityInTx(tx, {
        teamId: resource.teamId,
        resourceId: input.resourceId,
        recipientAccountId: input.recipientAccountId,
        subjectDisplayName: resource.displayName,
    });
    return {
        ok: true as const,
        resourceId: material.resourceId,
        resourceRevision: resource.revision,
        sourceMemberKey: material.sourceMemberKey,
        sourceVersion: material.sourceVersion,
        recipientMode: material.recipientMode,
        stored: material.stored,
        recipientContentPublicKeyFingerprint: currentness.currentness.contentPublicKeyFingerprint,
    };
}

/**
 * The source custodian is the only writer. The recipient grant is checked in
 * the same transaction, so a final revoke cannot race an upload into a usable
 * row. This is a projection upsert; it never creates source-owned credential,
 * Pool, Provider Connection, or Saved Secret records.
 */
export async function upsertTeamCredentialRecipientMaterialInTx(
    tx: Tx,
    input: Readonly<{
        actorAccountId: string;
        resourceId: string;
        recipientAccountId: string;
        sourceMemberKey: string;
        sourceVersion: string;
        recipientMode: RecipientMode;
        recipientContentPublicKeyFingerprint: string | null;
        stored: unknown;
        expectedResourceRevision: number;
        expectedStoredSourceVersion: string | null;
        expectedPublishedSourceVersion: string | null;
        authentication?: TeamOperationAuthenticationContext;
    }>,
): Promise<TeamCredentialRecipientMaterialUpsertResult> {
    const resource = await tx.teamCredentialResource.findUnique({
        where: { id: input.resourceId },
        select: { id: true, teamId: true, custodianAccountId: true, enabled: true, revision: true, sourceBindingJson: true, directSourceVersionsJson: true },
    });
    if (!resource) return { ok: false, reason: "resource_not_found" };
    if (resource.custodianAccountId !== input.actorAccountId) return { ok: false, reason: "source_owner_required" };
    const qualification = await qualifyCurrentTeamCredentialSourceCustodianInTx(tx, {
        teamId: resource.teamId,
        actorAccountId: input.actorAccountId,
        authentication: input.authentication,
    });
    if (!qualification.ok) return qualification;
    if (!resource.enabled) return { ok: false, reason: "disabled" };
    if (resource.revision !== input.expectedResourceRevision) return { ok: false, reason: "resource_changed" };
    const entitlement = await resolveTeamCredentialEntitlementInTx(tx, {
        resourceId: input.resourceId,
        accountId: input.recipientAccountId,
    });
    if (!entitlement.ok || !entitlement.mayReceiveDirect) return { ok: false, reason: "access_removed" };
    const recipient = await tx.account.findUnique({
        where: { id: input.recipientAccountId },
        select: { publicKey: true, encryptionMode: true, contentPublicKey: true, contentPublicKeySig: true },
    });
    if (!recipient) return { ok: false, reason: "resource_corrupt" };
    const recipientCurrentness = deriveAccountEncryptionCurrentnessFromRow(recipient);
    if (recipientCurrentness.status !== "ready") return { ok: false, reason: "recipient_binding_changed" };
    if (recipientCurrentness.currentness.encryptionMode !== input.recipientMode) {
        return { ok: false, reason: "recipient_binding_changed" };
    }
    let stored: TeamCredentialDirectMaterialStoredV1;
    try {
        stored = parseTeamCredentialDirectMaterialStoredV1(input.stored);
    } catch {
        return { ok: false, reason: "invalid_material" };
    }
    if (!isModeCompatible(input.recipientMode, stored)) return { ok: false, reason: "invalid_material" };
    const source = parseResourceSource(resource.sourceBindingJson);
    if (!source) return { ok: false, reason: "resource_corrupt" };
    const sourceCurrentness = await resolveTeamCredentialDirectSourceCurrentnessInTx(tx, {
        custodianAccountId: resource.custodianAccountId,
        source,
        sourceMemberKey: input.sourceMemberKey,
    });
    if (sourceCurrentness.status !== "current"
        || (stored.t === "plain"
        && computeTeamCredentialSourceMemberKeyV1(stored.v.sourceMember) !== input.sourceMemberKey)) {
        return { ok: false, reason: "source_changed" };
    }
    if (sourceCurrentness.sourceVersion !== null
        && input.sourceVersion !== sourceCurrentness.sourceVersion) {
        return { ok: false, reason: "source_changed" };
    }
    const publishedSourceVersions = parsePublishedTeamCredentialSourceVersions(resource.directSourceVersionsJson);
    if (!publishedSourceVersions) return { ok: false, reason: "resource_corrupt" };
    const publishedSourceVersion = publishedSourceVersions[input.sourceMemberKey] ?? null;
    if (publishedSourceVersion !== input.sourceVersion) {
        if (publishedSourceVersion !== input.expectedPublishedSourceVersion) {
            return { ok: false, reason: "source_changed" };
        }
        const nextPublishedSourceVersions = JSON.stringify({
            ...publishedSourceVersions,
            [input.sourceMemberKey]: input.sourceVersion,
        });
        const published = await tx.teamCredentialResource.updateMany({
            where: {
                id: resource.id,
                revision: resource.revision,
                directSourceVersionsJson: resource.directSourceVersionsJson,
            },
            data: { directSourceVersionsJson: nextPublishedSourceVersions },
        });
        if (published.count !== 1) return { ok: false, reason: "source_changed" };
    }
    if (input.recipientMode === "plain" && input.recipientContentPublicKeyFingerprint !== null) {
        return { ok: false, reason: "invalid_material" };
    }
    if (input.recipientMode === "e2ee" && (
        !input.recipientContentPublicKeyFingerprint
        || input.recipientContentPublicKeyFingerprint !== recipientCurrentness.currentness.contentPublicKeyFingerprint
    )) {
        return { ok: false, reason: "recipient_binding_changed" };
    }
    // Plain bytes are inspectable by the Home, so reject a tuple whose inner
    // binding disagrees with the authenticated resource/recipient/upload key.
    // E2EE bytes remain opaque to the Home and are checked again by the
    // recipient opener before disclosure.
    if (stored.t === "plain" && (
        stored.v.homeServerIdentityId.length === 0
        || stored.v.teamId !== resource.teamId
        || stored.v.resourceId !== input.resourceId
        || stored.v.resourceRevision !== resource.revision
        || stored.v.recipientAccountId !== input.recipientAccountId
        || stored.v.sourceVersion !== input.sourceVersion
        || computeTeamCredentialSourceMemberKeyV1(stored.v.sourceMember) !== input.sourceMemberKey
    )) {
        return { ok: false, reason: "invalid_material" };
    }
    const existing = await tx.teamCredentialRecipientMaterial.findUnique({
        where: { resourceId_recipientAccountId_sourceMemberKey: {
            resourceId: input.resourceId,
            recipientAccountId: input.recipientAccountId,
            sourceMemberKey: input.sourceMemberKey,
        } },
        select: { sourceVersion: true },
    });
    if ((existing?.sourceVersion ?? null) !== input.expectedStoredSourceVersion) {
        return { ok: false, reason: "source_changed" };
    }
    if (existing) {
        const updated = await tx.teamCredentialRecipientMaterial.updateMany({
            where: {
                resourceId: input.resourceId,
                recipientAccountId: input.recipientAccountId,
                sourceMemberKey: input.sourceMemberKey,
                sourceVersion: input.expectedStoredSourceVersion!,
            },
            data: {
                sourceVersion: input.sourceVersion,
                recipientMode: input.recipientMode,
                recipientContentPublicKeyFingerprint: input.recipientContentPublicKeyFingerprint,
                storedMaterial: prismaBytes(encodeStoredMaterial(stored)),
            },
        });
        if (updated.count !== 1) return { ok: false, reason: "source_changed" };
    } else {
        await tx.teamCredentialRecipientMaterial.create({ data: {
            resourceId: input.resourceId,
            recipientAccountId: input.recipientAccountId,
            sourceMemberKey: input.sourceMemberKey,
            sourceVersion: input.sourceVersion,
            recipientMode: input.recipientMode,
            recipientContentPublicKeyFingerprint: input.recipientContentPublicKeyFingerprint,
            storedMaterial: prismaBytes(encodeStoredMaterial(stored)),
        } });
    }
    return {
        ok: true,
        resourceId: input.resourceId,
        recipientAccountId: input.recipientAccountId,
        sourceMemberKey: input.sourceMemberKey,
        sourceVersion: input.sourceVersion,
    };
}
