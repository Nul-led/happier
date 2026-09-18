import { randomBytes, randomUUID } from "node:crypto";
import * as privacyKit from "privacy-kit";
import {
    TeamCredentialExternalApiKeyCreateInputV1Schema,
    TeamCredentialExternalApiKeySummaryV1Schema,
    createTeamCredentialExternalApiKeyDisplayPrefixV1,
    formatTeamCredentialExternalApiKeyV1,
    parseTeamCredentialExternalApiKeyV1,
    type TeamCredentialExternalApiKeyCreateInputV1,
    type TeamCredentialExternalApiKeyCreateOutputV1,
    type TeamCredentialExternalApiKeyListOutputV1,
    type TeamCredentialExternalApiKeySummaryV1,
} from "@happier-dev/protocol/teams";
import { TeamAuthenticationPolicyV1Schema } from "@happier-dev/protocol";
import type { Tx } from "@/storage/inTx";
import { AccountStatus } from "@/storage/enums.generated";
import { resolveTeamActorContextInTx, type TeamOperationAuthenticationContext } from "../actorContext";
import { resolveTeamCredentialCapabilities } from "../capabilities";
import { publishTeamChangedInTx } from "../teamChanges";
import { resolveTeamCredentialEntitlementInTx } from "./resourceAccess";
import { recordTeamCredentialActivityInTx, type TeamCredentialActivityActor } from "./resourceActivity";
import { createSha256SecretDigest, sha256SecretDigestMatches } from "../../auth/secretDigest";
import { qualifyTeamCredentialOperationInTx } from "./resourceRead";

const EXTERNAL_API_KEY_SECRET_BYTES = 32;

type ExternalApiKeyRow = Readonly<{
    id: string;
    resourceId: string;
    teamMembershipId: string;
    label: string;
    displayPrefix: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
}>;

export type CreateTeamCredentialExternalApiKeyResult =
    | Readonly<{ ok: true; token: string; key: TeamCredentialExternalApiKeyCreateOutputV1["key"] }>
    | Readonly<{ ok: false; error: "invalid_resource_input" | "resource_not_found" | "resource_forbidden" | "member_not_eligible" | "session_policy_incompatible" | "resource_changed" | "external_api_restricted_team" | "team_authentication_required" | "team_authentication_policy_unavailable" }>;

export type ListTeamCredentialExternalApiKeysResult =
    | Readonly<{ ok: true; keys: TeamCredentialExternalApiKeyListOutputV1["keys"] }>
    | Readonly<{ ok: false; error: "invalid_resource_input" | "resource_not_found" | "resource_forbidden" | "team_authentication_required" | "team_authentication_policy_unavailable" }>;

export type RevokeTeamCredentialExternalApiKeyResult =
    | Readonly<{ ok: true; keyId: string; revoked: boolean }>
    | Readonly<{ ok: false; error: "invalid_resource_input" | "resource_not_found" | "resource_forbidden" | "team_authentication_required" | "team_authentication_policy_unavailable" }>;

export type RevokeAllTeamCredentialExternalApiKeysResult =
    | Readonly<{ ok: true; resourceId: string; revokedCount: number }>
    | Readonly<{ ok: false; error: "invalid_resource_input" | "resource_not_found" | "resource_forbidden" | "team_authentication_required" | "team_authentication_policy_unavailable" }>;

export type VerifyTeamCredentialExternalApiKeyResult =
    | Readonly<{
        ok: true;
        keyId: string;
        resourceId: string;
        teamId: string;
        assignedAccountId: string;
        assignedTeamMembershipId: string;
        custodianAccountId: string;
        brokerMachineId: string | null;
        brokerPoolId: string | null;
        label: string;
        expiresAt: Date | null;
    }>
    | Readonly<{ ok: false; reason: "invalid_token" }>;

export type CurrentTeamCredentialExternalApiKeyAuthorityResult =
    | Readonly<{
        ok: true;
        keyId: string;
        resourceId: string;
        teamId: string;
        assignedAccountId: string;
        assignedTeamMembershipId: string;
        custodianAccountId: string;
        brokerMachineId: string | null;
        brokerPoolId: string | null;
        resourceRevision: number;
        sourceBindingJson: string;
        label: string;
        expiresAt: Date | null;
    }>
    | Readonly<{ ok: false; reason: "operation_not_current" | "resource_forbidden" }>;

function digestSecret(secret: string): string {
    return privacyKit.encodeBase64(new Uint8Array(createSha256SecretDigest(secret)), "base64url").replace(/=+$/u, "");
}

function digestMatches(storedDigest: string, suppliedSecret: string): boolean {
    return sha256SecretDigestMatches(storedDigest, suppliedSecret);
}

function project(row: ExternalApiKeyRow): TeamCredentialExternalApiKeySummaryV1 {
    return TeamCredentialExternalApiKeySummaryV1Schema.parse({
        keyId: row.id,
        resourceId: row.resourceId,
        teamMembershipId: row.teamMembershipId,
        label: row.label,
        displayPrefix: row.displayPrefix,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
    });
}

type ManagedTeamCredentialResource = Readonly<{
    id: string;
    teamId: string;
    custodianAccountId: string;
    sessionUsePolicy: string;
}>;

/**
 * Outcome of the shared manager-authority preflight. Tagged so callers narrow a
 * real discriminated union instead of probing an optional qualification.
 */
type ManagedExternalApiKeyResource<Creation extends boolean = false> =
    | Readonly<{ status: "missing" }>
    | Readonly<{ status: "forbidden" }>
    | Readonly<{
        status: "unqualified";
        error: (Creation extends true ? "external_api_restricted_team" : never)
            | "team_authentication_required" | "team_authentication_policy_unavailable";
    }>
    | Readonly<{ status: "authorized"; resource: ManagedTeamCredentialResource }>;

/**
 * Only minting a bearer is refused on a restricted Team, so the permanent
 * `external_api_restricted_team` refusal is visible to that caller alone;
 * listing and revoking cannot observe it.
 */
async function resolveManagedResourceInTx<Creation extends boolean = false>(tx: Tx, input: Readonly<{
    resourceId: string;
    actorAccountId: string;
    authentication: TeamOperationAuthenticationContext;
    rejectRestrictedForCreation?: Creation;
}>): Promise<ManagedExternalApiKeyResource<Creation>> {
    const resource = await tx.teamCredentialResource.findUnique({ where: { id: input.resourceId } });
    if (!resource) return { status: "missing" };
    const actor = await resolveTeamActorContextInTx(tx, { teamId: resource.teamId, actorAccountId: input.actorAccountId });
    if (!actor || !resolveTeamCredentialCapabilities({ ...actor, teamArchivedAt: actor.team.archivedAt }).manageCredentials) {
        return { status: "forbidden" };
    }
    const authenticationPolicy = actor.team.authenticationPolicy === null
        ? null
        : TeamAuthenticationPolicyV1Schema.safeParse(actor.team.authenticationPolicy);
    // A restricted Team cannot mint external keys at all: the bearer carries
    // no Team authentication, so this is a permanent typed refusal rather than
    // a transient policy-unavailable answer.
    if (input.rejectRestrictedForCreation === true
        && authenticationPolicy?.success
        && authenticationPolicy.data.mode === "restricted") {
        return { status: "unqualified", error: "external_api_restricted_team" } as ManagedExternalApiKeyResource<Creation>;
    }
    const qualification = await qualifyTeamCredentialOperationInTx(tx, actor, input.authentication);
    if (!qualification.ok) return { status: "unqualified", error: qualification.error };
    return { status: "authorized", resource };
}

function validExpiry(expiresAt: string | null, now: Date): Date | null | undefined {
    if (expiresAt === null) return null;
    const parsed = new Date(expiresAt);
    return Number.isFinite(parsed.getTime()) && parsed > now ? parsed : undefined;
}

/** Creates a resource-scoped bearer after re-reading both manager authority and assigned membership access. */
export async function createTeamCredentialExternalApiKeyInTx(
    tx: Tx,
    input: Readonly<{ actorAccountId: string; authentication: TeamOperationAuthenticationContext } & TeamCredentialExternalApiKeyCreateInputV1>,
    nowInput: Date = new Date(),
): Promise<CreateTeamCredentialExternalApiKeyResult> {
    const { actorAccountId, authentication, ...credentialInput } = input;
    const parsed = TeamCredentialExternalApiKeyCreateInputV1Schema.safeParse(credentialInput);
    if (!parsed.success) return { ok: false, error: "invalid_resource_input" };
    const now = new Date(nowInput.getTime());
    const expiresAt = validExpiry(parsed.data.expiresAt, now);
    if (expiresAt === undefined) return { ok: false, error: "invalid_resource_input" };
    const managed = await resolveManagedResourceInTx(tx, {
        resourceId: parsed.data.resourceId,
        actorAccountId,
        authentication,
        rejectRestrictedForCreation: true,
    });
    if (managed.status === "missing") return { ok: false, error: "resource_not_found" };
    if (managed.status === "forbidden") return { ok: false, error: "resource_forbidden" };
    if (managed.status === "unqualified") return { ok: false, error: managed.error };
    const resource = managed.resource;
    if (resource.sessionUsePolicy !== "personal_allowed") return { ok: false, error: "session_policy_incompatible" };

    const membership = await tx.teamMembership.findFirst({
        where: { id: parsed.data.teamMembershipId, teamId: resource.teamId },
        select: { id: true, accountId: true, status: true, account: { select: { status: true } } },
    });
    if (!membership || membership.status !== "active" || membership.account.status !== AccountStatus.active) {
        return { ok: false, error: "member_not_eligible" };
    }
    const entitlement = await resolveTeamCredentialEntitlementInTx(tx, { resourceId: resource.id, accountId: membership.accountId });
    if (!entitlement.ok || !entitlement.mayBroker) return { ok: false, error: "member_not_eligible" };

    const keyId = randomUUID();
    const secret = privacyKit.encodeBase64(new Uint8Array(randomBytes(EXTERNAL_API_KEY_SECRET_BYTES)), "base64url").replace(/=+$/u, "");
    const displayPrefix = createTeamCredentialExternalApiKeyDisplayPrefixV1(keyId);
    const row = await tx.teamCredentialExternalApiKey.create({
        data: {
            id: keyId,
            resourceId: resource.id,
            teamMembershipId: membership.id,
            label: parsed.data.label.trim(),
            displayPrefix,
            secretDigest: digestSecret(secret),
            createdAt: now,
            expiresAt,
        },
        select: { id: true, resourceId: true, teamMembershipId: true, label: true, displayPrefix: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    await recordTeamCredentialActivityInTx(tx, {
        teamId: resource.teamId, resourceId: resource.id, kind: "external_key_created",
        actor: { kind: "account", accountId: actorAccountId }, subjectDisplayName: row.label,
    });
    await publishTeamChangedInTx(tx, { teamId: resource.teamId, additionalAccountIds: [resource.custodianAccountId, actorAccountId, membership.accountId] });
    return { ok: true, token: formatTeamCredentialExternalApiKeyV1({ keyId, secret }), key: project(row) };
}

/** Lists safe key metadata only; plaintext and digest never cross this boundary. */
export async function listTeamCredentialExternalApiKeysInTx(
    tx: Tx,
    input: Readonly<{ actorAccountId: string; resourceId: string; authentication: TeamOperationAuthenticationContext }>,
): Promise<ListTeamCredentialExternalApiKeysResult> {
    if (!input.resourceId.trim()) return { ok: false, error: "invalid_resource_input" };
    const managed = await resolveManagedResourceInTx(tx, input);
    if (managed.status === "missing") return { ok: false, error: "resource_not_found" };
    if (managed.status === "forbidden") return { ok: false, error: "resource_forbidden" };
    if (managed.status === "unqualified") return { ok: false, error: managed.error };
    const rows = await tx.teamCredentialExternalApiKey.findMany({
        where: { resourceId: input.resourceId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, resourceId: true, teamMembershipId: true, label: true, displayPrefix: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    return { ok: true, keys: rows.map(project) };
}

export async function revokeTeamCredentialExternalApiKeyInTx(
    tx: Tx,
    input: Readonly<{ actorAccountId: string; resourceId: string; keyId: string; authentication: TeamOperationAuthenticationContext }>,
): Promise<RevokeTeamCredentialExternalApiKeyResult> {
    if (!input.resourceId.trim() || !input.keyId.trim()) return { ok: false, error: "invalid_resource_input" };
    const managed = await resolveManagedResourceInTx(tx, input);
    if (managed.status === "missing") return { ok: false, error: "resource_not_found" };
    if (managed.status === "forbidden") return { ok: false, error: "resource_forbidden" };
    if (managed.status === "unqualified") return { ok: false, error: managed.error };
    const key = await tx.teamCredentialExternalApiKey.findFirst({ where: { id: input.keyId, resourceId: input.resourceId }, select: { label: true } });
    if (!key) return { ok: true, keyId: input.keyId, revoked: false };
    const deleted = await tx.teamCredentialExternalApiKey.deleteMany({ where: { id: input.keyId, resourceId: input.resourceId } });
    if (deleted.count !== 1) return { ok: true, keyId: input.keyId, revoked: false };
    await recordTeamCredentialActivityInTx(tx, {
        teamId: managed.resource.teamId, resourceId: managed.resource.id, kind: "external_key_revoked",
        actor: { kind: "account", accountId: input.actorAccountId }, subjectDisplayName: key.label,
    });
    await publishTeamChangedInTx(tx, { teamId: managed.resource.teamId, additionalAccountIds: [managed.resource.custodianAccountId, input.actorAccountId] });
    return { ok: true, keyId: input.keyId, revoked: true };
}

export async function revokeAllTeamCredentialExternalApiKeysInTx(
    tx: Tx,
    input: Readonly<{ actorAccountId: string; resourceId: string; authentication: TeamOperationAuthenticationContext }>,
): Promise<RevokeAllTeamCredentialExternalApiKeysResult> {
    if (!input.resourceId.trim()) return { ok: false, error: "invalid_resource_input" };
    const managed = await resolveManagedResourceInTx(tx, input);
    if (managed.status === "missing") return { ok: false, error: "resource_not_found" };
    if (managed.status === "forbidden") return { ok: false, error: "resource_forbidden" };
    if (managed.status === "unqualified") return { ok: false, error: managed.error };
    const keys = await tx.teamCredentialExternalApiKey.findMany({ where: { resourceId: input.resourceId }, select: { label: true } });
    if (keys.length === 0) return { ok: true, resourceId: input.resourceId, revokedCount: 0 };
    const deleted = await tx.teamCredentialExternalApiKey.deleteMany({ where: { resourceId: input.resourceId } });
    for (const key of keys) {
        await recordTeamCredentialActivityInTx(tx, {
            teamId: managed.resource.teamId, resourceId: managed.resource.id, kind: "external_key_revoked",
            actor: { kind: "account", accountId: input.actorAccountId }, subjectDisplayName: key.label,
        });
    }
    await publishTeamChangedInTx(tx, { teamId: managed.resource.teamId, additionalAccountIds: [managed.resource.custodianAccountId, input.actorAccountId] });
    return { ok: true, resourceId: input.resourceId, revokedCount: deleted.count };
}

/** Revokes all keys for an ended membership lifetime before its FK row disappears. */
export async function revokeTeamCredentialExternalApiKeysForMembershipInTx(
    tx: Tx,
    input: Readonly<{ teamId: string; membershipId: string; actor: TeamCredentialActivityActor }>,
): Promise<number> {
    const keys = await tx.teamCredentialExternalApiKey.findMany({
        where: { teamMembershipId: input.membershipId, resource: { teamId: input.teamId } },
        select: { id: true, label: true, resourceId: true },
    });
    for (const key of keys) {
        await recordTeamCredentialActivityInTx(tx, {
            teamId: input.teamId, resourceId: key.resourceId, kind: "external_key_revoked",
            actor: input.actor, subjectDisplayName: key.label,
        });
    }
    const deleted = await tx.teamCredentialExternalApiKey.deleteMany({
        where: { id: { in: keys.map((key) => key.id) } },
    });
    return deleted.count;
}

/**
 * The one currentness evaluator shared by public bearer verification and the
 * broker's per-request admission recheck. The admitted-key arm is internal
 * provenance: the public bearer is stripped at the Home edge and is never sent
 * to the broker Machine.
 */
export async function resolveCurrentTeamCredentialExternalApiKeyAuthorityInTx(
    tx: Tx,
    input:
        | Readonly<{ kind: "bearer"; token: string }>
        | Readonly<{ kind: "admitted_key"; keyId: string }>,
    nowInput: Date = new Date(),
): Promise<CurrentTeamCredentialExternalApiKeyAuthorityResult> {
    let keyId: string;
    let suppliedSecret: string | null = null;
    if (input.kind === "bearer") {
        try {
            const parsed = parseTeamCredentialExternalApiKeyV1(input.token);
            keyId = parsed.keyId;
            suppliedSecret = parsed.secret;
        } catch {
            return { ok: false, reason: "operation_not_current" };
        }
    } else {
        keyId = input.keyId;
    }
    const row = await tx.teamCredentialExternalApiKey.findUnique({
        where: { id: keyId },
        select: {
            id: true, resourceId: true, teamMembershipId: true, label: true, secretDigest: true,
            expiresAt: true,
            resource: {
                select: {
                    teamId: true,
                    custodianAccountId: true,
                    brokerMachineId: true,
                    brokerPoolId: true,
                    revision: true,
                    sourceBindingJson: true,
                    enabled: true,
                    sessionUsePolicy: true,
                },
            },
            membership: { select: { accountId: true, status: true, account: { select: { status: true } } } },
        },
    });
    const now = new Date(nowInput.getTime());
    if (!row || (suppliedSecret !== null && !digestMatches(row.secretDigest, suppliedSecret))
        || (row.expiresAt !== null && row.expiresAt <= now)
        || row.membership.status !== "active"
        || row.membership.account.status !== AccountStatus.active) {
        return { ok: false, reason: "operation_not_current" };
    }
    if (!row.resource.enabled || row.resource.sessionUsePolicy !== "personal_allowed") {
        return { ok: false, reason: "resource_forbidden" };
    }
    const entitlement = await resolveTeamCredentialEntitlementInTx(tx, { resourceId: row.resourceId, accountId: row.membership.accountId });
    if (!entitlement.ok || !entitlement.mayBroker) return { ok: false, reason: "resource_forbidden" };
    return {
        ok: true,
        keyId: row.id,
        resourceId: row.resourceId,
        teamId: row.resource.teamId,
        assignedAccountId: row.membership.accountId,
        assignedTeamMembershipId: row.teamMembershipId,
        custodianAccountId: row.resource.custodianAccountId,
        brokerMachineId: row.resource.brokerMachineId,
        brokerPoolId: row.resource.brokerPoolId,
        resourceRevision: row.resource.revision,
        sourceBindingJson: row.resource.sourceBindingJson,
        label: row.label,
        expiresAt: row.expiresAt,
    };
}

/** Verifies and rechecks current resource/member entitlement before any broker dispatch. */
export async function verifyTeamCredentialExternalApiKeyInTx(
    tx: Tx,
    input: Readonly<{ token: string }>,
    nowInput: Date = new Date(),
): Promise<VerifyTeamCredentialExternalApiKeyResult> {
    const result = await resolveCurrentTeamCredentialExternalApiKeyAuthorityInTx(
        tx,
        { kind: "bearer", token: input.token },
        nowInput,
    );
    if (!result.ok) return { ok: false, reason: "invalid_token" };
    const { resourceRevision: _resourceRevision, sourceBindingJson: _sourceBindingJson, ...verified } = result;
    return verified;
}
