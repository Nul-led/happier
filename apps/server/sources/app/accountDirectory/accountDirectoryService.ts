import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import tweetnacl from "tweetnacl";
import { db } from "@/storage/db";
import { inTx, type Tx } from "@/storage/inTx";
import { readCachedServerIdentityIdForHotPath } from "@/app/serverIdentity/serverIdentity";
import { getPublicUrl } from "@/storage/blob/files";
import { AccountDirectoryError } from "./accountDirectoryErrors";
import {
    AccountDirectoryLinkPutRequestSchema,
    AccountDirectoryMeResponseSchema,
    AccountDirectoryHomePutRequestSchema,
    AccountDirectoryHomePutResponseV1Schema,
    AccountDirectoryHomesResponseV1Schema,
    HomeConnectionDescriptorV1Schema,
    HomeLoginAssertionV1Schema,
    HomeLoginRedemptionResultV1Schema,
    HomeLoginRedemptionResponseV1Schema,
    type AccountDirectoryMeResponseV1,
    type HomeConnectionDescriptorV1,
    type HomeLoginAssertionV1,
    type HomeLoginRedemptionResultV1,
} from "./accountDirectorySchemas";
import {
    mintHomeLoginAssertion,
    verifyHomeLoginAssertionSignature,
} from "./accountDirectorySigner";
import {
    ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_CREDENTIAL_PLAINTEXT_BYTES,
    ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_TOKEN_UTF8_BYTES,
    computeCanonicalDomainSeparatedDigest,
    createHomeLoginAssertionSigningBytesV1,
    decodeBase64,
    encodeBase64,
    isValidBoxBundlePublicKey,
    sealBoxBundle,
} from "@happier-dev/protocol";

const HOME_DIRECTORY_ENTRY_SELECT = {
    homeServerIdentityId: true,
    canonicalServerUrl: true,
    label: true,
    connectionDescriptor: true,
    createdAt: true,
    updatedAt: true,
} as const satisfies Prisma.AccountHomeDirectoryEntrySelect;

type HomeDirectoryEntryRow = Prisma.AccountHomeDirectoryEntryGetPayload<{
    select: typeof HOME_DIRECTORY_ENTRY_SELECT;
}>;

const ACCOUNT_DIRECTORY_LINK_SELECT = {
    accountId: true,
    issuerServerIdentityId: true,
    issuerSubjectId: true,
    issuerSigningKeyId: true,
    issuerSigningPublicKey: true,
    createdAt: true,
} as const satisfies Prisma.AccountDirectoryLinkSelect;

type AccountDirectoryLinkRow = Prisma.AccountDirectoryLinkGetPayload<{
    select: typeof ACCOUNT_DIRECTORY_LINK_SELECT;
}>;

const HOME_LOGIN_APPROVAL_BINDING_DOMAIN_V1 =
    "happier.account-directory.home-approval-binding.v1" as const;

function createHomeLoginApprovalBindingProof(
    assertion: HomeLoginAssertionV1,
    link: AccountDirectoryLinkRow,
): string {
    return computeCanonicalDomainSeparatedDigest(HOME_LOGIN_APPROVAL_BINDING_DOMAIN_V1, [
        createHomeLoginAssertionSigningBytesV1(assertion),
        assertion.signatureBase64Url,
        link.accountId,
        link.issuerServerIdentityId,
        link.issuerSubjectId,
        link.issuerSigningKeyId,
        link.issuerSigningPublicKey,
        String(link.createdAt.getTime()),
    ]);
}

async function invalidateAccountAssertionApprovalsForLink(
    tx: Tx,
    link: AccountDirectoryLinkRow,
): Promise<void> {
    await tx.authPairingSession.deleteMany({
        where: {
            accountId: link.accountId,
            flow: "account_assertion",
            requesterIssuerServerIdentityId: link.issuerServerIdentityId,
            requesterIssuerSubjectId: link.issuerSubjectId,
        },
    });
}

function mapDescriptor(value: unknown): HomeConnectionDescriptorV1 {
    const parsed = HomeConnectionDescriptorV1Schema.safeParse(value);
    if (!parsed.success) throw new AccountDirectoryError("invalid_request", "Invalid Home connection descriptor");
    return parsed.data;
}

function mapHomeRow(row: HomeDirectoryEntryRow, preferredHomeServerIdentityId: string | null) {
    const descriptor = mapDescriptor(row.connectionDescriptor);
    const mapped = {
        v: 1 as const,
        homeServerIdentityId: row.homeServerIdentityId,
        canonicalServerUrl: row.canonicalServerUrl,
        label: row.label,
        connectionDescriptor: descriptor,
        createdAtMs: row.createdAt.getTime(),
        updatedAtMs: row.updatedAt.getTime(),
        preferred: preferredHomeServerIdentityId === row.homeServerIdentityId,
    };
    const parsed = AccountDirectoryHomePutResponseV1Schema.safeParse(mapped);
    if (!parsed.success) throw new AccountDirectoryError("invalid_request", "Invalid stored Home directory entry");
    return parsed.data;
}

export async function readAccountDirectoryMe(accountId: string): Promise<AccountDirectoryMeResponseV1> {
    const user = await db.account.findUnique({
        where: { id: accountId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            avatar: true,
            AccountIdentity: { select: { provider: true, providerUserId: true }, orderBy: { provider: "asc" } },
        },
    });
    if (!user) throw new AccountDirectoryError("not_found", "Account not found");
    const displayName = [user.firstName, user.lastName].filter((part): part is string => Boolean(part?.trim())).join(" ") || null;
    return AccountDirectoryMeResponseSchema.parse({
        v: 1,
        accountId: user.id,
        displayName,
        avatar: (() => {
            const avatar = user.avatar;
            if (!avatar || typeof avatar !== "object" || Array.isArray(avatar)) return null;
            const path = "path" in avatar ? avatar.path : null;
            return typeof path === "string" ? getPublicUrl(path) : null;
        })(),
        linkedAuthenticationMethods: user.AccountIdentity.map((identity) => ({
            providerId: identity.provider,
            login: identity.providerUserId,
        })),
    });
}

export async function listAccountHomeDirectory(accountId: string) {
    return inTx(async (tx) => {
        const account = await tx.account.findUnique({ where: { id: accountId }, select: { preferredHomeServerIdentityId: true } });
        if (!account) throw new AccountDirectoryError("not_found", "Account not found");
        const rows = await tx.accountHomeDirectoryEntry.findMany({
            where: { accountId },
            orderBy: [{ updatedAt: "desc" }, { homeServerIdentityId: "asc" }],
            select: HOME_DIRECTORY_ENTRY_SELECT,
        });
        return AccountDirectoryHomesResponseV1Schema.parse({
            v: 1 as const,
            preferredHomeServerIdentityId: account.preferredHomeServerIdentityId ?? null,
            homes: rows.map((row) => mapHomeRow(row, account.preferredHomeServerIdentityId ?? null)),
        });
    });
}

export async function upsertAccountHomeDirectoryEntry(params: Readonly<{
    accountId: string;
    homeServerIdentityId: string;
    label: string;
    connectionDescriptor: unknown;
}>): Promise<ReturnType<typeof mapHomeRow>> {
    const body = AccountDirectoryHomePutRequestSchema.parse({
        v: 1,
        label: params.label,
        connectionDescriptor: params.connectionDescriptor,
    });
    if (body.connectionDescriptor.homeServerIdentityId !== params.homeServerIdentityId) {
        throw new AccountDirectoryError("invalid_request", "Home identity does not match descriptor");
    }
    return inTx(async (tx) => {
        const account = await tx.account.findUnique({ where: { id: params.accountId }, select: { preferredHomeServerIdentityId: true } });
        if (!account) throw new AccountDirectoryError("not_found", "Account not found");
        const where = { accountId_homeServerIdentityId: { accountId: params.accountId, homeServerIdentityId: params.homeServerIdentityId } };
        const data = {
            canonicalServerUrl: body.connectionDescriptor.canonicalServerUrl,
            label: body.label,
            connectionDescriptor: body.connectionDescriptor,
        };
        const existing = await tx.accountHomeDirectoryEntry.findUnique({
            where,
            select: { homeServerIdentityId: true },
        });
        const row = existing
            ? await tx.accountHomeDirectoryEntry.update({ where, data, select: HOME_DIRECTORY_ENTRY_SELECT })
            : await tx.accountHomeDirectoryEntry.create({
                data: { accountId: params.accountId, homeServerIdentityId: params.homeServerIdentityId, ...data },
                select: HOME_DIRECTORY_ENTRY_SELECT,
            });
        let preferredHomeServerIdentityId = account.preferredHomeServerIdentityId ?? null;
        if (preferredHomeServerIdentityId === null) {
            const preferred = await tx.account.updateMany({
                where: { id: params.accountId, preferredHomeServerIdentityId: null },
                data: { preferredHomeServerIdentityId: params.homeServerIdentityId },
            });
            if (preferred.count === 1) preferredHomeServerIdentityId = params.homeServerIdentityId;
            else {
                const refreshed = await tx.account.findUnique({
                    where: { id: params.accountId },
                    select: { preferredHomeServerIdentityId: true },
                });
                preferredHomeServerIdentityId = refreshed?.preferredHomeServerIdentityId ?? null;
            }
        }
        return mapHomeRow(row, preferredHomeServerIdentityId);
    });
}

export async function deleteAccountHomeDirectoryEntry(params: Readonly<{ accountId: string; homeServerIdentityId: string }>): Promise<void> {
    await inTx(async (tx) => {
        await tx.accountHomeDirectoryEntry.deleteMany({ where: { accountId: params.accountId, homeServerIdentityId: params.homeServerIdentityId } });
        await tx.account.updateMany({
            where: { id: params.accountId, preferredHomeServerIdentityId: params.homeServerIdentityId },
            data: { preferredHomeServerIdentityId: null },
        });
    });
}

export async function setPreferredAccountHome(params: Readonly<{ accountId: string; homeServerIdentityId: string | null }>): ReturnType<typeof listAccountHomeDirectory> {
    await inTx(async (tx) => {
        if (params.homeServerIdentityId !== null) {
            const exists = await tx.accountHomeDirectoryEntry.findUnique({
                where: { accountId_homeServerIdentityId: { accountId: params.accountId, homeServerIdentityId: params.homeServerIdentityId } },
                select: { homeServerIdentityId: true },
            });
            if (!exists) throw new AccountDirectoryError("preferred_home_not_found", "Home is not present in the directory");
        }
        await tx.account.updateMany({ where: { id: params.accountId }, data: { preferredHomeServerIdentityId: params.homeServerIdentityId } });
    });
    return listAccountHomeDirectory(params.accountId);
}

export async function upsertAccountDirectoryLink(params: Readonly<{
    accountId: string;
    issuerServerIdentityId: string;
    issuerSubjectId: string;
    issuerSigningKeyId: string;
    issuerSigningPublicKeyBase64Url: string;
    relink?: boolean;
    bodyIssuerServerIdentityId?: string;
}>): Promise<void> {
    if (params.bodyIssuerServerIdentityId && params.bodyIssuerServerIdentityId !== params.issuerServerIdentityId) {
        throw new AccountDirectoryError("invalid_request", "Issuer identity does not match path");
    }
    const body = AccountDirectoryLinkPutRequestSchema.parse({
        v: 1,
        issuerServerIdentityId: params.issuerServerIdentityId,
        issuerSubjectId: params.issuerSubjectId,
        issuerSigningKeyId: params.issuerSigningKeyId,
        issuerSigningPublicKeyBase64Url: params.issuerSigningPublicKeyBase64Url,
        relink: params.relink ?? false,
    });
    let publicKey: Uint8Array;
    try {
        publicKey = decodeBase64(body.issuerSigningPublicKeyBase64Url, "base64url");
    } catch {
        throw new AccountDirectoryError("invalid_request", "Invalid issuer signing public key");
    }
    if (publicKey.length !== tweetnacl.sign.publicKeyLength) throw new AccountDirectoryError("invalid_request", "Invalid issuer signing public key");
    if (createHash("sha256").update(publicKey).digest("hex") !== body.issuerSigningKeyId) {
        throw new AccountDirectoryError("invalid_request", "Issuer signing key ID does not match the public key");
    }
    const storedPublicKey: Uint8Array<ArrayBuffer> = new Uint8Array(publicKey);
    await inTx(async (tx) => {
        const existing = await tx.accountDirectoryLink.findFirst({
            where: { accountId: params.accountId, issuerServerIdentityId: params.issuerServerIdentityId },
            select: ACCOUNT_DIRECTORY_LINK_SELECT,
        });
        if (existing) {
            const subjectChanged = existing.issuerSubjectId !== body.issuerSubjectId;
            const keyIdChanged = existing.issuerSigningKeyId !== body.issuerSigningKeyId;
            const rawKeyChanged = !Buffer.from(existing.issuerSigningPublicKey).equals(Buffer.from(publicKey));
            if (!subjectChanged && !keyIdChanged && !rawKeyChanged) return;
            if (body.relink !== true) {
                throw new AccountDirectoryError("directory_link_conflict", "Issuer link changes require explicit relink");
            }
            await invalidateAccountAssertionApprovalsForLink(tx, existing);
            if (subjectChanged) {
                await tx.accountDirectoryLink.deleteMany({
                    where: { accountId: params.accountId, issuerServerIdentityId: params.issuerServerIdentityId },
                });
                await tx.accountDirectoryLink.create({
                    data: {
                        accountId: params.accountId,
                        issuerServerIdentityId: params.issuerServerIdentityId,
                        issuerSubjectId: body.issuerSubjectId,
                        issuerSigningKeyId: body.issuerSigningKeyId,
                        issuerSigningPublicKey: storedPublicKey,
                    },
                });
                return;
            }
            await tx.accountDirectoryLink.update({
                where: { issuerServerIdentityId_issuerSubjectId: { issuerServerIdentityId: params.issuerServerIdentityId, issuerSubjectId: body.issuerSubjectId } },
                data: { issuerSigningKeyId: body.issuerSigningKeyId, issuerSigningPublicKey: storedPublicKey },
            });
            return;
        }
        await tx.accountDirectoryLink.create({
            data: {
                accountId: params.accountId,
                issuerServerIdentityId: params.issuerServerIdentityId,
                issuerSubjectId: body.issuerSubjectId,
                issuerSigningKeyId: body.issuerSigningKeyId,
                issuerSigningPublicKey: storedPublicKey,
            },
        });
    });
}

export async function deleteAccountDirectoryLink(params: Readonly<{ accountId: string; issuerServerIdentityId: string }>): Promise<void> {
    await inTx(async (tx) => {
        const existing = await tx.accountDirectoryLink.findFirst({
            where: { accountId: params.accountId, issuerServerIdentityId: params.issuerServerIdentityId },
            select: ACCOUNT_DIRECTORY_LINK_SELECT,
        });
        const deleted = await tx.accountDirectoryLink.deleteMany({
            where: { accountId: params.accountId, issuerServerIdentityId: params.issuerServerIdentityId },
        });
        if (existing && deleted.count > 0) {
            await invalidateAccountAssertionApprovalsForLink(tx, existing);
        }
    });
}

export async function mintAccountHomeLoginAssertion(params: Readonly<{
    accountId: string;
    homeServerIdentityId: string;
    clientBoxPublicKeyBase64: string;
    env?: NodeJS.ProcessEnv;
}>): Promise<HomeLoginAssertionV1> {
    let clientKey: Uint8Array;
    try {
        clientKey = decodeBase64(params.clientBoxPublicKeyBase64, "base64");
    } catch {
        throw new AccountDirectoryError("invalid_request", "Invalid client public key");
    }
    if (
        clientKey.length !== tweetnacl.box.publicKeyLength
        || encodeBase64(clientKey, "base64") !== params.clientBoxPublicKeyBase64
    ) throw new AccountDirectoryError("invalid_request", "Invalid client public key");
    // A syntactically canonical low-order key would seal the assertion to a
    // shared secret unrelated private scalars can derive; reject it before
    // any directory work or signing.
    if (!isValidBoxBundlePublicKey(clientKey)) {
        throw new AccountDirectoryError("invalid_client_key", "Invalid client public key", 400);
    }
    const entry = await db.accountHomeDirectoryEntry.findUnique({
        where: { accountId_homeServerIdentityId: { accountId: params.accountId, homeServerIdentityId: params.homeServerIdentityId } },
        select: { homeServerIdentityId: true, canonicalServerUrl: true, connectionDescriptor: true },
    });
    if (!entry || entry.homeServerIdentityId !== params.homeServerIdentityId) throw new AccountDirectoryError("not_found", "Home is not present in the directory");
    const descriptor = mapDescriptor(entry.connectionDescriptor);
    if (descriptor.homeServerIdentityId !== params.homeServerIdentityId || descriptor.canonicalServerUrl !== entry.canonicalServerUrl) {
        throw new AccountDirectoryError("invalid_request", "Stored Home descriptor does not match its directory entry");
    }
    return mintHomeLoginAssertion({
        issuerSubjectId: params.accountId,
        audienceHomeServerIdentityId: params.homeServerIdentityId,
        clientBoxPublicKeyBase64: params.clientBoxPublicKeyBase64,
        env: params.env,
    });
}

function validateAssertionAgainstLink(
    assertion: HomeLoginAssertionV1,
    link: AccountDirectoryLinkRow,
    nowMs: number | undefined,
): void {
    if (link.issuerServerIdentityId !== assertion.issuerServerIdentityId) {
        throw new AccountDirectoryError("assertion_issuer_untrusted");
    }
    if (link.issuerSubjectId !== assertion.issuerSubjectId) {
        throw new AccountDirectoryError("invalid_subject");
    }
    const keyId = link.issuerSigningKeyId;
    const publicKey = link.issuerSigningPublicKey;
    if (keyId !== assertion.keyId || createHash("sha256").update(publicKey).digest("hex") !== keyId) {
        throw new AccountDirectoryError("assertion_issuer_untrusted");
    }
    const signatureStatus = verifyHomeLoginAssertionSignature(assertion, publicKey, nowMs);
    if (signatureStatus === "expired") throw new AccountDirectoryError("assertion_expired");
    if (signatureStatus === "clock_skew") throw new AccountDirectoryError("assertion_clock_skew");
    if (signatureStatus !== "ok") throw new AccountDirectoryError("invalid_assertion");
}

export async function redeemHomeLoginAssertion(params: Readonly<{
    assertion: unknown;
    env?: NodeJS.ProcessEnv;
    nowMs?: number;
    approvalId?: string;
    /** Home/Lane-05 owns approval and final Home-local token issuance. */
    homeApprovalGate?: { evaluate: (facts: Readonly<{
        accountId: string;
        issuerServerIdentityId: string;
        issuerSubjectId: string;
        requesterBoxPublicKeyBase64: string;
        approvalBindingProof: string;
        deviceLabel: string | null;
        approvalId?: string;
    }>) => Promise<
        | { kind: "allowed"; approvedRequest?: { approvalId: string; bindingProof: string } }
        | { kind: "approval_required"; request: { approvalId: string; deviceLabel: string | null; expiresAtMs: number } }
        | { kind: "rejected" | "expired" | "already_decided" }
    > };
    issueHomeToken?: (tx: Tx, accountId: string) => Promise<string>;
}>): Promise<HomeLoginRedemptionResultV1> {
    const parsed = HomeLoginAssertionV1Schema.safeParse(params.assertion);
    if (!parsed.success) throw new AccountDirectoryError("invalid_assertion", "Invalid Home login assertion");
    const assertion = parsed.data;
    const currentServerIdentityId = readCachedServerIdentityIdForHotPath(params.env ?? process.env);
    if (!currentServerIdentityId) throw new AccountDirectoryError("home_redemption_unavailable", "Home identity is not established");
    if (assertion.audienceHomeServerIdentityId !== currentServerIdentityId) throw new AccountDirectoryError("assertion_wrong_audience");
    const link: AccountDirectoryLinkRow | null = await db.accountDirectoryLink.findUnique({
        where: { issuerServerIdentityId_issuerSubjectId: { issuerServerIdentityId: assertion.issuerServerIdentityId, issuerSubjectId: assertion.issuerSubjectId } },
        select: ACCOUNT_DIRECTORY_LINK_SELECT,
    });
    if (!link) {
        const issuerLink = await db.accountDirectoryLink.findFirst({
            where: { issuerServerIdentityId: assertion.issuerServerIdentityId },
            select: { issuerSubjectId: true },
        });
        throw new AccountDirectoryError(issuerLink ? "invalid_subject" : "directory_link_not_found");
    }
    validateAssertionAgainstLink(assertion, link, params.nowMs);
    let clientPublicKey: Uint8Array;
    try { clientPublicKey = decodeBase64(assertion.clientBoxPublicKeyBase64, "base64"); } catch { throw new AccountDirectoryError("invalid_client_key"); }
    // The sealed token must be bound to this exact high-order client key;
    // low-order keys defeat that binding and are rejected before the approval
    // gate or any token issuance.
    if (!isValidBoxBundlePublicKey(clientPublicKey)) throw new AccountDirectoryError("invalid_client_key");
    // Account Service assertions are inputs to the target Home only. The gate
    // and token issuer are injected from the Home auth/pairing owner; without
    // that owner this route fails closed and cannot mint an Account token.
    if (!params.homeApprovalGate) {
        throw new AccountDirectoryError("home_redemption_unavailable", "Home approval gate is unavailable");
    }
    const decision = await params.homeApprovalGate.evaluate({
        accountId: link.accountId,
        issuerServerIdentityId: assertion.issuerServerIdentityId,
        issuerSubjectId: assertion.issuerSubjectId,
        requesterBoxPublicKeyBase64: assertion.clientBoxPublicKeyBase64,
        approvalBindingProof: createHomeLoginApprovalBindingProof(assertion, link),
        deviceLabel: null,
        ...(params.approvalId ? { approvalId: params.approvalId } : {}),
    });
    if (decision.kind === "approval_required") {
        return HomeLoginRedemptionResultV1Schema.parse({
            v: 1,
            outcome: "approval_required",
            homeServerIdentityId: currentServerIdentityId,
            approvalId: decision.request.approvalId,
            deviceLabel: decision.request.deviceLabel,
            expiresAtMs: Math.min(decision.request.expiresAtMs, assertion.expiresAtMs),
        });
    }
    if (decision.kind !== "allowed") throw new AccountDirectoryError("home_unavailable", "Home approval rejected or expired");
    const issueHomeToken = params.issueHomeToken;
    if (!issueHomeToken) throw new AccountDirectoryError("home_redemption_unavailable", "Home token issuer is unavailable");
    const issuedAtMs = params.nowMs ?? Date.now();
    const token = await inTx(async (tx) => {
        const currentLink: AccountDirectoryLinkRow | null = await tx.accountDirectoryLink.findUnique({
            where: { issuerServerIdentityId_issuerSubjectId: { issuerServerIdentityId: assertion.issuerServerIdentityId, issuerSubjectId: assertion.issuerSubjectId } },
            select: ACCOUNT_DIRECTORY_LINK_SELECT,
        });
        if (!currentLink) {
            const currentIssuerLink = await tx.accountDirectoryLink.findFirst({
                where: { issuerServerIdentityId: assertion.issuerServerIdentityId },
                select: { issuerSubjectId: true },
            });
            throw new AccountDirectoryError(currentIssuerLink ? "invalid_subject" : "directory_link_not_found");
        }
        if (currentLink.accountId !== link.accountId) {
            throw new AccountDirectoryError("assertion_issuer_untrusted");
        }
        validateAssertionAgainstLink(assertion, currentLink, params.nowMs);
        if (decision.approvedRequest) {
            const currentBindingProof = createHomeLoginApprovalBindingProof(assertion, currentLink);
            if (currentBindingProof !== decision.approvedRequest.bindingProof) {
                throw new AccountDirectoryError("home_unavailable", "Home approval no longer matches the current directory link");
            }
            const currentApproval = await tx.authPairingSession.findFirst({
                where: {
                    id: decision.approvedRequest.approvalId,
                    accountId: currentLink.accountId,
                    flow: "account_assertion",
                    approvalStatus: "approved",
                    expiresAt: { gt: new Date() },
                    requestedBindingProof: currentBindingProof,
                },
                select: { id: true },
            });
            if (!currentApproval) {
                throw new AccountDirectoryError("home_unavailable", "Home approval is no longer current");
            }
        }
        return issueHomeToken(tx, currentLink.accountId);
    });
    const tokenUtf8Bytes = new TextEncoder().encode(token);
    const credentialPlaintext = new TextEncoder().encode(JSON.stringify({ token }));
    if (
        !token
        || token.trim() !== token
        || tokenUtf8Bytes.byteLength > ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_TOKEN_UTF8_BYTES
        || credentialPlaintext.byteLength > ACCOUNT_DIRECTORY_MAX_HOME_LOGIN_CREDENTIAL_PLAINTEXT_BYTES
    ) {
        throw new AccountDirectoryError("home_redemption_unavailable", "Home token issuer returned invalid credentials");
    }
    return HomeLoginRedemptionResponseV1Schema.parse({
        v: 1,
        homeServerIdentityId: currentServerIdentityId,
        sealedHomeTokenBase64Url: encodeBase64(sealBoxBundle({
            plaintext: credentialPlaintext,
            recipientPublicKey: clientPublicKey,
            randomBytes: (length) => new Uint8Array(randomBytes(length)),
        }), "base64url"),
        issuedAtMs,
        // The wire name is locked. This is the assertion/redemption validity
        // window; the ordinary Home credential itself remains durable.
        expiresAtMs: assertion.expiresAtMs,
    });
}
