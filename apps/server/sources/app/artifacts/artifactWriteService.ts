import { inTx, type Tx } from "@/storage/inTx";
import { db } from '@/storage/db';
import { deletePrivateFile } from '@/storage/blob/files';
import type { ArtifactBlobWriteV1 } from '@happier-dev/protocol';
import { prepareArtifactBlobWrite, admitArtifactBlobWriteInTx, discardArtifactBlobCandidate, cleanupArtifactOrphanBlobs, type PreparedArtifactBlobWrite } from './artifactBlobService';
import { markAccountChanged } from "@/app/changes/markAccountChanged";
import {
    deriveAccountEncryptionCurrentnessFromRow,
} from "@/app/encryption/accountContentKeyAdmission";
import type {
    AccountEncryptionMigrateArtifactsDirective,
} from "@happier-dev/protocol";
import { ArtifactRecipientKeyEnvelopesV1Schema, parseEncryptedDataKeyEnvelopeV1 } from "@happier-dev/protocol";
import { buildPluginDomainAccountChangeEntityId } from "@happier-dev/protocol/changes";
import { checkArtifactStorageBudgetInTx, retainArtifactBodyRevisionInTx, type ArtifactQuotaExceeded } from "./artifactStorageService";
import {
    artifactDataKeyMatchesAccountMode,
    artifactStoredContentMatchesAccountMode,
    artifactUpdateMatchesStoredMode,
    isPlainArtifactDataKeyBytes,
    openArtifactStoredContentBytes,
    openArtifactStoredContentPair,
    storePlainArtifactDbBytes,
} from "./artifactStoredContent";
import {
    artifactClassificationFromRelations,
    artifactOrdinaryWhere,
    artifactVisibleWhere,
} from "./artifactClassification";
import {
    readArtifactForCallerInTx,
    resolveArtifactAccessInTx,
    resolveArtifactAudienceInTx,
    applyArtifactRecipientKeyEnvelopesInTx,
} from "./artifactAccessService";

type Cursor = number;

export class ArtifactAccountEncryptionMigrationConflictError extends Error {
    constructor() {
        super("Artifact account-encryption migration lost its version precondition");
        this.name = "ArtifactAccountEncryptionMigrationConflictError";
    }
}

export class ArtifactAccountEncryptionMigrationQuotaExceededError extends Error {
    constructor(readonly quota: ArtifactQuotaExceeded) {
        super("Artifact account-encryption migration exceeds its configured storage budget");
        this.name = "ArtifactAccountEncryptionMigrationQuotaExceededError";
    }
}

export type ArtifactAccountEncryptionMigrationResult =
    | Readonly<{ status: "applied" }>
    | Readonly<{ status: "not_empty" }>
    | Readonly<{ status: "migration_incomplete" }>
    | Readonly<{ status: "invalid_content" }>;

export type ArtifactAccountEncryptionMigrationPostStateResult =
    | Readonly<{ status: "matched" }>
    | Readonly<{ status: "mismatch" }>
    | Readonly<{ status: "migration_incomplete" }>;

type ArtifactAccountEncryptionMigrationRow = Readonly<{
    id: string;
    header: Uint8Array;
    headerVersion: number;
    body: Uint8Array;
    bodyVersion: number;
    dataEncryptionKey: Uint8Array;
    seq: number;
    revisions: readonly Readonly<{ bodyVersion: number; body: Uint8Array }>[];
    blobs: readonly Readonly<{ id: string; storageKey: string; encryptionMode: string; storedSizeBytes: bigint }>[];
    pluginUiArtifact: Readonly<{
        release: Readonly<{
            accountId: string;
            pluginId: string;
        }>;
    }> | null;
    packageAssetRelease: Readonly<{
        accountId: string;
        pluginId: string;
    }> | null;
}>;

async function readArtifactAccountEncryptionMigrationRowsInTx(
    tx: Tx,
    accountId: string,
): Promise<readonly ArtifactAccountEncryptionMigrationRow[]> {
    return await tx.artifact.findMany({
        where: { accountId },
        select: {
            id: true,
            header: true,
            headerVersion: true,
            body: true,
            bodyVersion: true,
            dataEncryptionKey: true,
            seq: true,
            revisions: { select: { bodyVersion: true, body: true } },
            blobs: { select: { id: true, storageKey: true, encryptionMode: true, storedSizeBytes: true } },
            pluginUiArtifact: {
                select: {
                    release: {
                        select: {
                            accountId: true,
                            pluginId: true,
                        },
                    },
                },
            },
            packageAssetRelease: {
                select: {
                    accountId: true,
                    pluginId: true,
                },
            },
        },
    });
}

function artifactBytesEqual(
    left: Uint8Array,
    right: Uint8Array,
): boolean {
    return left.byteLength === right.byteLength
        && left.every((value, index) => value === right[index]);
}

/**
 * Read-only exact Artifact post-state matcher for Account-transition replay.
 */
export async function matchArtifactAccountEncryptionMigrationPostStateInTx(
    params: Readonly<{
        tx: Tx;
        accountId: string;
        toMode: "plain" | "e2ee";
        directive: AccountEncryptionMigrateArtifactsDirective;
    }>,
): Promise<ArtifactAccountEncryptionMigrationPostStateResult> {
    const rows =
        await readArtifactAccountEncryptionMigrationRowsInTx(
            params.tx,
            params.accountId,
        );
    if (rows.some((row) => artifactClassificationFromRelations({
        pluginUiArtifact: row.pluginUiArtifact,
        packageAssetRelease: row.packageAssetRelease,
    }, params.accountId).kind === "invalid")) {
        // Classification links must remain one Account-local plugin owner.
        // Do not reinterpret corruption as an ordinary Artifact.
        return { status: "migration_incomplete" };
    }
    if (params.directive.action === "assert_empty") {
        return {
            status: rows.length === 0
                ? "matched"
                : "mismatch",
        };
    }
    const itemsById = new Map(
        params.directive.items.map((item) => [
            item.artifactId,
            item,
        ] as const),
    );
    if (
        itemsById.size !== params.directive.items.length
        || itemsById.size !== rows.length
    ) {
        return { status: "mismatch" };
    }
    for (const row of rows) {
        const item = itemsById.get(row.id);
        if (!item) return { status: "mismatch" };
        if (row.blobs.length > 0 || item.blobs.length > 0) return { status: 'mismatch' };
        const revisionsByVersion = new Map(item.revisions.map(revision => [revision.bodyVersion, revision]));
        if (revisionsByVersion.size !== item.revisions.length || revisionsByVersion.size !== row.revisions.length) {
            return { status: "mismatch" };
        }
        for (const revision of row.revisions) {
            const expected = revisionsByVersion.get(revision.bodyVersion);
            const openedBody = openArtifactStoredContentBytes({ accountId: params.accountId, artifactId: row.id,
                mode: params.toMode, field: "body", dataEncryptionKey: row.dataEncryptionKey, content: revision.body });
            if (!expected || !openedBody || !artifactBytesEqual(openedBody, Buffer.from(expected.body, "base64"))) {
                return { status: "mismatch" };
            }
        }
        const expectedHeader =
            new Uint8Array(Buffer.from(item.header, "base64"));
        const expectedBody =
            new Uint8Array(Buffer.from(item.body, "base64"));
        const expectedDataEncryptionKey =
            new Uint8Array(
                Buffer.from(item.dataEncryptionKey, "base64"),
            );
        const opened = openArtifactStoredContentPair({
            accountId: params.accountId,
            artifactId: row.id,
            mode: params.toMode,
            dataEncryptionKey: row.dataEncryptionKey,
            header: row.header,
            body: row.body,
        });
        if (
            !opened
            || row.headerVersion
                !== item.expectedHeaderVersion + 1
            || row.bodyVersion
                !== item.expectedBodyVersion + 1
            || !artifactBytesEqual(
                opened.header,
                expectedHeader,
            )
            || !artifactBytesEqual(
                opened.body,
                expectedBody,
            )
            || !artifactBytesEqual(
                row.dataEncryptionKey,
                expectedDataEncryptionKey,
            )
            || !artifactStoredContentMatchesAccountMode({
                mode: params.toMode,
                header: opened.header,
                body: opened.body,
                dataEncryptionKey: row.dataEncryptionKey,
            })
        ) {
            return { status: "mismatch" };
        }
    }
    return { status: "matched" };
}

export async function migrateArtifactAccountEncryptionInTx(params: Readonly<{
    tx: Tx;
    accountId: string;
    fromMode: "plain" | "e2ee";
    toMode: "plain" | "e2ee";
    directive: AccountEncryptionMigrateArtifactsDirective;
    markChanged?: (artifactId: string) => Promise<unknown>;
}>): Promise<ArtifactAccountEncryptionMigrationResult> {
    const rows =
        await readArtifactAccountEncryptionMigrationRowsInTx(
            params.tx,
            params.accountId,
        );
    if (rows.some((row) => artifactClassificationFromRelations({
        pluginUiArtifact: row.pluginUiArtifact,
        packageAssetRelease: row.packageAssetRelease,
    }, params.accountId).kind === "invalid")) {
        return { status: "migration_incomplete" };
    }
    if (params.directive.action === "assert_empty") {
        return rows.length === 0
            ? { status: "applied" }
            : { status: "not_empty" };
    }

    const itemsById = new Map(
        params.directive.items.map((item) => [item.artifactId, item]),
    );
    if (
        itemsById.size !== params.directive.items.length
        || itemsById.size !== rows.length
    ) {
        return { status: "migration_incomplete" };
    }

    const prepared = new Map<string, Readonly<{
        header: Uint8Array;
        body: Uint8Array;
        dataEncryptionKey: Uint8Array;
        seq: number;
        currentHeaderBytes: number;
        currentBodyBytes: number;
        ordinary: boolean;
        revisions: readonly Readonly<{ bodyVersion: number; expectedStoredBody: Uint8Array; body: Uint8Array }>[];
    }>>();
    for (const row of rows) {
        const item = itemsById.get(row.id);
        if (
            !item
            || item.expectedHeaderVersion !== row.headerVersion
            || item.expectedBodyVersion !== row.bodyVersion
            || !artifactBytesEqual(
                row.dataEncryptionKey, new Uint8Array(Buffer.from(item.expectedDataEncryptionKey, "base64")),
            )
        ) {
            return { status: "migration_incomplete" };
        }
        // A document key transition must never reinterpret unconverted private bytes.
        // Complete binary conversion is admitted only by the private-storage lifecycle preparation.
        if (row.blobs.length > 0 || item.blobs.length > 0) return { status: 'migration_incomplete' };
        if (!artifactDataKeyMatchesAccountMode({ mode: params.fromMode, dataEncryptionKey: row.dataEncryptionKey })) {
            return { status: "invalid_content" };
        }
        if (!ArtifactRecipientKeyEnvelopesV1Schema.safeParse(item.recipientKeyEnvelopes).success
            || item.recipientKeyEnvelopes.some(envelope => !parseEncryptedDataKeyEnvelopeV1(new Uint8Array(Buffer.from(envelope.encryptedDataKey, "base64"))))
            || (item.recipientKeyEnvelopes.length > 0 && params.toMode === "plain")) {
            return { status: "invalid_content" };
        }
        const header = new Uint8Array(Buffer.from(item.header, "base64"));
        const body = new Uint8Array(Buffer.from(item.body, "base64"));
        const dataEncryptionKey = new Uint8Array(
            Buffer.from(item.dataEncryptionKey, "base64"),
        );
        if (!artifactStoredContentMatchesAccountMode({
            mode: params.toMode,
            header,
            body,
            dataEncryptionKey,
        })) {
            return { status: "invalid_content" };
        }
        const storedHeader =
            params.toMode === "plain"
                ? storePlainArtifactDbBytes({
                    accountId: params.accountId,
                    artifactId: row.id,
                    field: "header",
                    content: header,
                })
                : header;
        const storedBody =
            params.toMode === "plain"
                ? storePlainArtifactDbBytes({
                    accountId: params.accountId,
                    artifactId: row.id,
                    field: "body",
                    content: body,
                })
                : body;
        if (!storedHeader || !storedBody) {
            return { status: "invalid_content" };
        }
        const revisionsByVersion = new Map(item.revisions.map(revision => [revision.bodyVersion, revision]));
        if (revisionsByVersion.size !== item.revisions.length || revisionsByVersion.size !== row.revisions.length) {
            return { status: "migration_incomplete" };
        }
        const revisions = [];
        for (const revision of row.revisions) {
            const target = revisionsByVersion.get(revision.bodyVersion);
            const sourceBody = openArtifactStoredContentBytes({ accountId: params.accountId, artifactId: row.id,
                mode: params.fromMode,
                field: "body", dataEncryptionKey: row.dataEncryptionKey, content: revision.body });
            if (!target || !sourceBody || !artifactBytesEqual(sourceBody, Buffer.from(target.expectedBody, "base64"))) {
                return { status: "migration_incomplete" };
            }
            const body = Buffer.from(target.body, "base64");
            if (!artifactUpdateMatchesStoredMode({ dataEncryptionKey, body })) return { status: "invalid_content" };
            const stored = params.toMode === "plain" ? storePlainArtifactDbBytes({
                accountId: params.accountId, artifactId: row.id, field: "body", content: body,
            }) : body;
            if (!stored) return { status: "invalid_content" };
            revisions.push({ bodyVersion: revision.bodyVersion, expectedStoredBody: revision.body, body: stored });
        }
        prepared.set(row.id, {
            header: storedHeader,
            body: storedBody,
            dataEncryptionKey,
            seq: row.seq,
            currentHeaderBytes: row.header.byteLength,
            currentBodyBytes: row.body.byteLength,
            ordinary: artifactClassificationFromRelations({ pluginUiArtifact: row.pluginUiArtifact,
                packageAssetRelease: row.packageAssetRelease }, params.accountId).kind === "ordinary",
            revisions,
        });
    }

    const pluginIdByArtifactId = new Map(
        rows.flatMap((row) => {
            const classification = artifactClassificationFromRelations({
                pluginUiArtifact: row.pluginUiArtifact,
                packageAssetRelease: row.packageAssetRelease,
            }, params.accountId);
            return classification.kind === "plugin"
                ? [[row.id, classification.pluginId] as const]
                : [];
        }),
    );
    const markChanged =
        params.markChanged
        ?? (async (artifactId: string) => {
            const pluginId = pluginIdByArtifactId.get(artifactId);
            if (pluginId) {
                const hint = {
                    pluginDomain: "availability" as const,
                    pluginId,
                };
                return await markAccountChanged(params.tx, {
                    accountId: params.accountId,
                    kind: "pluginDomain",
                    entityId: buildPluginDomainAccountChangeEntityId(hint),
                    hint,
                });
            }
            return await markAccountChanged(params.tx, {
                accountId: params.accountId,
                kind: "artifact",
                entityId: artifactId,
            });
        });
    for (const item of params.directive.items) {
        const replacement = prepared.get(item.artifactId)!;
        if (replacement.ordinary) {
            const quota = await checkArtifactStorageBudgetInTx(params.tx, {
                accountId: params.accountId, artifactId: item.artifactId,
                nextHeaderBytes: replacement.header.byteLength, nextBodyBytes: replacement.body.byteLength,
                currentHeaderBytes: replacement.currentHeaderBytes, currentBodyBytes: replacement.currentBodyBytes,
                revisionBytesDelta: replacement.revisions.reduce((sum, revision) => sum + revision.body.byteLength - revision.expectedStoredBody.byteLength, 0),
            });
            if (quota) throw new ArtifactAccountEncryptionMigrationQuotaExceededError(quota);
        }
        const updated = await params.tx.artifact.updateMany({
            where: {
                accountId: params.accountId,
                id: item.artifactId,
                headerVersion: item.expectedHeaderVersion,
                bodyVersion: item.expectedBodyVersion,
                dataEncryptionKey: Buffer.from(item.expectedDataEncryptionKey, "base64"),
            },
            data: {
                header: Buffer.from(replacement.header),
                headerVersion: item.expectedHeaderVersion + 1,
                body: Buffer.from(replacement.body),
                bodyVersion: item.expectedBodyVersion + 1,
                dataEncryptionKey: Buffer.from(
                    replacement.dataEncryptionKey,
                ),
                seq: replacement.seq + 1,
                updatedAt: new Date(),
            },
        });
        if (updated.count !== 1) {
            throw new ArtifactAccountEncryptionMigrationConflictError();
        }
        // Ordinary body writers acquire this same parent CAS before retaining
        // or pruning history. Recheck the whole set after acquiring that fence.
        if (await params.tx.artifactRevision.count({ where: { artifactId: item.artifactId } }) !== replacement.revisions.length) {
            throw new ArtifactAccountEncryptionMigrationConflictError();
        }
        for (const revision of replacement.revisions) {
            const migrated = await params.tx.artifactRevision.updateMany({
                where: { artifactId: item.artifactId, bodyVersion: revision.bodyVersion, body: Buffer.from(revision.expectedStoredBody) },
                data: { body: Buffer.from(revision.body) },
            });
            if (migrated.count !== 1) throw new ArtifactAccountEncryptionMigrationConflictError();
        }
        // A replacement resource key invalidates every previously wrapped key.
        await params.tx.artifactKeyEnvelope.deleteMany({ where: { artifactId: item.artifactId } });
        const notifiedRecipients = new Set<string>();
        if (params.toMode === "e2ee") {
            const committed = await applyArtifactRecipientKeyEnvelopesInTx(params.tx, {
                artifactId: item.artifactId, recipientKeyEnvelopes: item.recipientKeyEnvelopes,
            });
            for (const accountId of committed.appliedRecipientAccountIds) notifiedRecipients.add(accountId);
        }
        // Removed wraps are also a content change: live, unprepared recipients
        // must refresh into the truthful locked state (plain targets refresh too).
        for (const accountId of await resolveArtifactAudienceInTx(params.tx, item.artifactId)) {
            if (accountId === params.accountId || notifiedRecipients.has(accountId)) continue;
            await markAccountChanged(params.tx, { accountId, kind: "artifact", entityId: item.artifactId });
        }
        await markChanged(item.artifactId);
    }
    return { status: "applied" };
}

export type CreateArtifactResult =
    | ({ ok: false } & ArtifactQuotaExceeded)
    | { ok: true; didWrite: true; cursor: Cursor; artifact: ArtifactRow }
    | { ok: true; didWrite: false; artifact: ArtifactRow }
    | {
        ok: false;
        error:
            | "invalid-params"
            | "conflict"
            | "internal";
      };

type ArtifactRow = {
    id: string;
    seq: number;
    header: Uint8Array;
    headerVersion: number;
    body: Uint8Array;
    bodyVersion: number;
    dataEncryptionKey: Uint8Array;
    createdAt: Date;
    updatedAt: Date;
};

export async function createArtifact(params: {
    actorUserId: string;
    artifactId: string;
    header: Uint8Array;
    body: Uint8Array;
    dataEncryptionKey: Uint8Array;
    blob?: ArtifactBlobWriteV1;
}): Promise<CreateArtifactResult> {
    const actorUserId = typeof params.actorUserId === "string" ? params.actorUserId : "";
    const artifactId = typeof params.artifactId === "string" ? params.artifactId : "";
    const header = params.header instanceof Uint8Array ? params.header : null;
    const body = params.body instanceof Uint8Array ? params.body : null;
    const dataEncryptionKey = params.dataEncryptionKey instanceof Uint8Array ? params.dataEncryptionKey : null;

    if (!actorUserId || !artifactId || !header || !body || !dataEncryptionKey) {
        return { ok: false, error: "invalid-params" };
    }

    let preparedBlob: PreparedArtifactBlobWrite | undefined;
    let admitted = false;
    try {
        if (params.blob) {
            if (!params.blob.content) return { ok: false, error: 'invalid-params' };
            preparedBlob = await prepareArtifactBlobWrite({ accountId: actorUserId, artifactId, blob: params.blob }) ?? undefined;
        }
        const result = await inTx(async (tx) => await createArtifactTx(tx, {
            actorUserId,
            artifactId,
            header,
            body,
            dataEncryptionKey,
            blob: params.blob, preparedBlob,
        }));
        admitted = result.ok && result.didWrite;
        return result;
    } catch {
        return { ok: false, error: "internal" };
    } finally {
        if (!admitted) await discardArtifactBlobCandidate(preparedBlob);
    }
}

export async function createArtifactTx(
    tx: Tx,
    params: {
        actorUserId: string;
        artifactId: string;
        header: Uint8Array;
        body: Uint8Array;
        dataEncryptionKey: Uint8Array;
        blob?: ArtifactBlobWriteV1;
        preparedBlob?: PreparedArtifactBlobWrite;
        /**
         * A qualified owner may replace the generic Artifact invalidation only
         * while composing its classification in this same transaction.
         */
        markChanged?: (artifactId: string) => Promise<Cursor>;
    }
): Promise<CreateArtifactResult> {
    const account = await tx.account.findUnique({
        where: { id: params.actorUserId },
        select: {
            encryptionMode: true,
            publicKey: true,
            contentPublicKey: true,
            contentPublicKeySig: true,
        },
    });
    const currentness = account
        ? deriveAccountEncryptionCurrentnessFromRow(account)
        : null;
    if (currentness?.status !== "ready") {
        return { ok: false, error: "invalid-params" };
    }
    const existing = await tx.artifact.findUnique({
        where: { id: params.artifactId },
        select: {
            id: true,
            accountId: true,
            header: true,
            headerVersion: true,
            body: true,
            bodyVersion: true,
            dataEncryptionKey: true,
            seq: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            pluginUiArtifact: {
                select: {
                    release: {
                        select: {
                            accountId: true,
                            pluginId: true,
                        },
                    },
                },
            },
            packageAssetRelease: {
                select: {
                    accountId: true,
                    pluginId: true,
                },
            },
        },
    });

    if (existing) {
        if (
            existing.accountId !== params.actorUserId
            || existing.deletedAt
            || artifactClassificationFromRelations({
                pluginUiArtifact: existing.pluginUiArtifact,
                packageAssetRelease: existing.packageAssetRelease,
            }, params.actorUserId).kind !== "ordinary"
        ) {
            return { ok: false, error: "conflict" };
        }

        const opened = openArtifactStoredContentPair({
            accountId: existing.accountId,
            artifactId: existing.id,
            mode: currentness.currentness.encryptionMode,
            dataEncryptionKey: existing.dataEncryptionKey,
            header: existing.header,
            body: existing.body,
        });
        if (!opened) {
            return { ok: false, error: "internal" };
        }
        const {
            accountId: _accountId,
            pluginUiArtifact: _pluginUiArtifact,
            packageAssetRelease: _packageAssetRelease,
            deletedAt: _deletedAt,
            ...artifact
        } = existing;
        return {
            ok: true,
            didWrite: false,
            artifact: {
                ...artifact,
                header: opened.header,
                body: opened.body,
            },
        };
    }

    if (
        !artifactStoredContentMatchesAccountMode({
        mode: currentness.currentness.encryptionMode,
        header: params.header,
        body: params.body,
        dataEncryptionKey: params.dataEncryptionKey,
    })
    ) {
        return { ok: false, error: "invalid-params" };
    }

    const plain = isPlainArtifactDataKeyBytes(params.dataEncryptionKey);
    const storedHeader = plain
        ? storePlainArtifactDbBytes({
            accountId: params.actorUserId,
            artifactId: params.artifactId,
            field: "header",
            content: params.header,
        })
        : params.header;
    const storedBody = plain
        ? storePlainArtifactDbBytes({
            accountId: params.actorUserId,
            artifactId: params.artifactId,
            field: "body",
            content: params.body,
        })
        : params.body;
    if (!storedHeader || !storedBody) {
        return { ok: false, error: "internal" };
    }

    if (params.markChanged && params.blob) return { ok: false, error: 'invalid-params' };
    if (!params.markChanged && !await admitArtifactBlobWriteInTx(tx, { artifactId: params.artifactId,
        mode: currentness.currentness.encryptionMode, body: params.body, blob: params.blob, prepared: params.preparedBlob })) {
        return { ok: false, error: 'invalid-params' };
    }

    // Qualified plugin publication is governed by its own availability budgets.
    if (!params.markChanged) {
        const quota = await checkArtifactStorageBudgetInTx(tx, { accountId: params.actorUserId,
            artifactId: params.artifactId, nextHeaderBytes: storedHeader.byteLength, nextBodyBytes: storedBody.byteLength,
            nextBlobId: params.blob?.blobId ?? null, candidateBlobBytes: Number(params.preparedBlob?.row.storedSizeBytes ?? 0) });
        if (quota) return { ok: false, ...quota };
    }

    const created = await tx.artifact.create({
        data: {
            id: params.artifactId,
            accountId: params.actorUserId,
            header: Buffer.from(storedHeader),
            headerVersion: 1,
            body: Buffer.from(storedBody),
            bodyVersion: 1,
            currentBlobId: params.blob?.blobId ?? null,
            dataEncryptionKey: Buffer.from(params.dataEncryptionKey),
            seq: 0,
        },
        select: {
            id: true,
            header: true,
            headerVersion: true,
            body: true,
            bodyVersion: true,
            dataEncryptionKey: true,
            seq: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    if (params.preparedBlob?.candidate) await tx.artifactBlob.create({ data: params.preparedBlob.row });

    const cursor = await (
        params.markChanged
        ?? (async (artifactId: string) =>
            await markAccountChanged(tx, {
                accountId: params.actorUserId,
                kind: "artifact",
                entityId: artifactId,
            }))
    )(params.artifactId);
    return {
        ok: true,
        didWrite: true,
        cursor,
        artifact: {
            ...created,
            header: params.header,
            body: params.body,
        },
    };
}

export type UpdateArtifactResult =
    | ({ ok: false } & ArtifactQuotaExceeded)
    | {
        ok: true;
        cursor: Cursor;
        ownerUpdate?: Readonly<{ accountId: string; cursor: Cursor }>;
        header?: { bytes: Uint8Array; version: number };
        body?: { bytes: Uint8Array; version: number };
      }
    | {
        ok: false;
        error:
            | "invalid-params"
            | "not-found"
            | "version-mismatch"
            | "internal";
        current?: {
            headerVersion: number;
            header: Uint8Array;
            bodyVersion: number;
            body: Uint8Array;
        };
      };

export async function updateArtifact(params: {
    actorUserId: string;
    artifactId: string;
    header?: { bytes: Uint8Array; expectedVersion: number };
    body?: { bytes: Uint8Array; expectedVersion: number };
    blob?: ArtifactBlobWriteV1;
}): Promise<UpdateArtifactResult> {
    const actorUserId = typeof params.actorUserId === "string" ? params.actorUserId : "";
    const artifactId = typeof params.artifactId === "string" ? params.artifactId : "";
    const header = params.header;
    const body = params.body;

    if (!actorUserId || !artifactId) {
        return { ok: false, error: "invalid-params" };
    }
    if (!header && !body) {
        return { ok: false, error: "invalid-params" };
    }
    if (header && (!(header.bytes instanceof Uint8Array) || typeof header.expectedVersion !== "number")) {
        return { ok: false, error: "invalid-params" };
    }
    if (body && (!(body.bytes instanceof Uint8Array) || typeof body.expectedVersion !== "number")) {
        return { ok: false, error: "invalid-params" };
    }

    let preparedBlob: PreparedArtifactBlobWrite | undefined;
    let admitted = false;
    try {
        const access = await inTx(tx => resolveArtifactAccessInTx(tx, { actorAccountId: actorUserId, artifactId }));
        if (!access || access.level === 'view') return { ok: false, error: 'not-found' };
        await cleanupArtifactOrphanBlobs(artifactId);
        if (params.blob) {
            if (!body) return { ok: false, error: 'invalid-params' };
            const owner = await db.artifact.findUnique({ where: { id: artifactId }, select: { accountId: true } });
            if (!owner) return { ok: false, error: 'not-found' };
            preparedBlob = await prepareArtifactBlobWrite({ accountId: owner.accountId, artifactId, blob: params.blob }) ?? undefined;
        }
        const result = await inTx(async (tx) => await updateArtifactTx(tx, {
            actorUserId,
            artifactId,
            header,
            body,
            blob: params.blob, preparedBlob,
        }));
        admitted = result.ok;
        if (result.ok) await cleanupArtifactOrphanBlobs(artifactId);
        return result;
    } catch {
        return { ok: false, error: "internal" };
    } finally {
        if (!admitted) await discardArtifactBlobCandidate(preparedBlob);
    }
}

export async function updateArtifactTx(
    tx: Tx,
    params: {
        actorUserId: string;
        artifactId: string;
        header?: { bytes: Uint8Array; expectedVersion: number };
        body?: { bytes: Uint8Array; expectedVersion: number };
        expectedRevision?: Readonly<{ headerVersion: number; bodyVersion: number }>;
        blob?: ArtifactBlobWriteV1;
        preparedBlob?: PreparedArtifactBlobWrite;
        restoredBlobId?: string | null;
    },
): Promise<UpdateArtifactResult> {
    const access = await resolveArtifactAccessInTx(tx, {
        actorAccountId: params.actorUserId,
        artifactId: params.artifactId,
    });
    if (!access || access.level === "view") return { ok: false, error: "not-found" };
    if (access.ownerAccountId !== params.actorUserId) {
        const readable = await readArtifactForCallerInTx(tx, {
            actorAccountId: params.actorUserId,
            artifactId: params.artifactId,
        });
        if (!readable.ok) return { ok: false, error: "not-found" };
    }
    const ownerAccountId = access.ownerAccountId;
    const account = await tx.account.findUnique({
        where: { id: ownerAccountId },
        select: {
            encryptionMode: true,
            publicKey: true,
            contentPublicKey: true,
            contentPublicKeySig: true,
        },
    });
    const currentness = account
        ? deriveAccountEncryptionCurrentnessFromRow(account)
        : null;
    if (currentness?.status !== "ready") {
        return { ok: false, error: "invalid-params" };
    }
    const current = await tx.artifact.findFirst({
        where: {
            id: params.artifactId,
            accountId: ownerAccountId,
            ...artifactVisibleWhere,
        },
        select: {
            id: true,
            seq: true,
            header: true,
            headerVersion: true,
            body: true,
            bodyVersion: true,
            dataEncryptionKey: true,
            currentBlobId: true,
        },
    });

    if (!current) {
        return { ok: false, error: "not-found" };
    }

    if (!artifactUpdateMatchesStoredMode({
        dataEncryptionKey: current.dataEncryptionKey,
        ...(params.header ? { header: params.header.bytes } : {}),
        ...(params.body ? { body: params.body.bytes } : {}),
    })) {
        return { ok: false, error: "invalid-params" };
    }
    const openedCurrent = openArtifactStoredContentPair({
        accountId: ownerAccountId,
        artifactId: current.id,
        mode: currentness.currentness.encryptionMode,
        dataEncryptionKey: current.dataEncryptionKey,
        header: current.header,
        body: current.body,
    });
    if (!openedCurrent) {
        return { ok: false, error: "internal" };
    }

    const headerMismatch = (params.header && current.headerVersion !== params.header.expectedVersion)
        || (params.expectedRevision && current.headerVersion !== params.expectedRevision.headerVersion);
    const bodyMismatch = (params.body && current.bodyVersion !== params.body.expectedVersion)
        || (params.expectedRevision && current.bodyVersion !== params.expectedRevision.bodyVersion);
    if (headerMismatch || bodyMismatch) {
        return {
            ok: false,
            error: "version-mismatch",
            current: {
                headerVersion: current.headerVersion,
                header: openedCurrent.header,
                bodyVersion: current.bodyVersion,
                body: openedCurrent.body,
            },
        };
    }

    const updateData: {
        updatedAt: Date;
        seq: number;
        header?: Uint8Array<ArrayBuffer>;
        headerVersion?: number;
        body?: Uint8Array<ArrayBuffer>;
        bodyVersion?: number;
        currentBlobId?: string | null;
    } = {
        updatedAt: new Date(),
        seq: current.seq + 1,
    };

    let headerUpdate: { bytes: Uint8Array; version: number } | undefined;
    let bodyUpdate: { bytes: Uint8Array; version: number } | undefined;

    if (params.header) {
        const storedHeader = isPlainArtifactDataKeyBytes(current.dataEncryptionKey)
            ? storePlainArtifactDbBytes({
                accountId: ownerAccountId,
                artifactId: current.id,
                field: "header",
                content: params.header.bytes,
            })
            : params.header.bytes;
        if (!storedHeader) return { ok: false, error: "internal" };
        updateData.header = Buffer.from(storedHeader);
        updateData.headerVersion = params.header.expectedVersion + 1;
        headerUpdate = { bytes: params.header.bytes, version: params.header.expectedVersion + 1 };
    }
    if (params.body) {
        if (params.restoredBlobId === undefined && !await admitArtifactBlobWriteInTx(tx, {
            artifactId: current.id, mode: currentness.currentness.encryptionMode, body: params.body.bytes,
            blob: params.blob, prepared: params.preparedBlob, currentBlobId: current.currentBlobId,
        })) return { ok: false, error: 'invalid-params' };
        if (params.restoredBlobId && !await tx.artifactBlob.findFirst({ where: { id: params.restoredBlobId,
            artifactId: current.id, encryptionMode: currentness.currentness.encryptionMode } })) return { ok: false, error: 'invalid-params' };
        const storedBody = isPlainArtifactDataKeyBytes(current.dataEncryptionKey)
            ? storePlainArtifactDbBytes({
                accountId: ownerAccountId,
                artifactId: current.id,
                field: "body",
                content: params.body.bytes,
            })
            : params.body.bytes;
        if (!storedBody) return { ok: false, error: "internal" };
        updateData.body = Buffer.from(storedBody);
        updateData.bodyVersion = params.body.expectedVersion + 1;
        updateData.currentBlobId = params.restoredBlobId ?? params.blob?.blobId ?? null;
        bodyUpdate = { bytes: params.body.bytes, version: params.body.expectedVersion + 1 };
    }

    const quota = await checkArtifactStorageBudgetInTx(tx, { accountId: ownerAccountId, artifactId: current.id,
        nextHeaderBytes: (updateData.header ?? current.header).byteLength,
        nextBodyBytes: (updateData.body ?? current.body).byteLength,
        currentHeaderBytes: current.header.byteLength, currentBodyBytes: current.body.byteLength, retainCurrentBody: Boolean(params.body),
        currentBlobId: current.currentBlobId, nextBlobId: params.body ? updateData.currentBlobId : current.currentBlobId,
        candidateBlobBytes: params.preparedBlob?.candidate ? Number(params.preparedBlob.row.storedSizeBytes) : 0 });
    if (quota) return { ok: false, ...quota };

    const { count } = await tx.artifact.updateMany({
        where: {
            id: params.artifactId,
            accountId: ownerAccountId,
            ...(params.header && { headerVersion: params.header.expectedVersion }),
            ...(params.body && { bodyVersion: params.body.expectedVersion }),
            ...(params.expectedRevision && { headerVersion: params.expectedRevision.headerVersion, bodyVersion: params.expectedRevision.bodyVersion }),
            ...artifactVisibleWhere,
        },
        data: updateData,
    });

    if (count === 0) {
        const fresh = await tx.artifact.findFirst({
            where: {
                id: params.artifactId,
                accountId: ownerAccountId,
                ...artifactOrdinaryWhere,
            },
            select: {
                id: true,
                header: true,
                headerVersion: true,
                body: true,
                bodyVersion: true,
                dataEncryptionKey: true,
            },
        });
        if (!fresh) {
            return { ok: false, error: "not-found" };
        }

        const openedFresh = openArtifactStoredContentPair({
            accountId: ownerAccountId,
            artifactId: fresh.id,
            mode: currentness.currentness.encryptionMode,
            dataEncryptionKey: fresh.dataEncryptionKey,
            header: fresh.header,
            body: fresh.body,
        });
        if (!openedFresh) {
            return { ok: false, error: "internal" };
        }
        return {
            ok: false,
            error: "version-mismatch",
            current: {
                headerVersion: fresh.headerVersion,
                header: openedFresh.header,
                bodyVersion: fresh.bodyVersion,
                body: openedFresh.body,
            },
        };
    }

    if (params.preparedBlob?.candidate) await tx.artifactBlob.create({ data: params.preparedBlob.row });
    if (params.body) await retainArtifactBodyRevisionInTx(tx, {
        artifactId: current.id, bodyVersion: current.bodyVersion, body: current.body, blobId: current.currentBlobId,
    });

    const recipients = await resolveArtifactAudienceInTx(tx, params.artifactId);
    const recipientCursors = [];
    for (const accountId of recipients) {
        const cursor = await markAccountChanged(tx, { accountId, kind: "artifact", entityId: params.artifactId });
        recipientCursors.push({ accountId, cursor });
    }
    const cursor = recipientCursors.find((recipient) => recipient.accountId === params.actorUserId)?.cursor;
    if (cursor === undefined) throw new Error("Artifact writer is missing from its authorized audience");
    const ownerCursor = recipientCursors.find((recipient) => recipient.accountId === ownerAccountId)?.cursor;
    if (ownerCursor === undefined) throw new Error("Artifact owner is missing from its authorized audience");
    return { ok: true, cursor,
        ...(ownerAccountId !== params.actorUserId ? { ownerUpdate: { accountId: ownerAccountId, cursor: ownerCursor } } : {}),
        ...(headerUpdate ? { header: headerUpdate } : {}), ...(bodyUpdate ? { body: bodyUpdate } : {}) };
}

class ArtifactDeleteVersionConflictError extends Error {}

export type DeleteArtifactResult =
    | { ok: true; cursor: Cursor }
    | {
        ok: false;
        error:
            | "invalid-params"
            | "not-found"
            | "version-mismatch"
            | "internal";
      };

export async function deleteArtifact(params: {
    actorUserId: string;
    artifactId: string;
    expectedRevision?: Readonly<{ headerVersion: number; bodyVersion: number }>;
}): Promise<DeleteArtifactResult> {
    const actorUserId = typeof params.actorUserId === "string" ? params.actorUserId : "";
    const artifactId = typeof params.artifactId === "string" ? params.artifactId : "";

    if (!actorUserId || !artifactId) {
        return { ok: false, error: "invalid-params" };
    }

    try {
        const retirement = await inTx(async (tx) => {
            const artifact = await tx.artifact.findFirst({
                where: {
                    id: artifactId,
                    accountId: actorUserId,
                    ...artifactOrdinaryWhere,
                },
                select: {
                    id: true,
                    dataEncryptionKey: true,
                    deletedAt: true,
                    headerVersion: true,
                    bodyVersion: true,
                    blobs: { select: { id: true, storageKey: true }, orderBy: { id: 'asc' } },
                },
            });
            if (!artifact) {
                return { ok: false, error: "not-found" };
            }
            const account = await tx.account.findUnique({
                where: { id: actorUserId },
                select: {
                    encryptionMode: true,
                    publicKey: true,
                    contentPublicKey: true,
                    contentPublicKeySig: true,
                },
            });
            const currentness = account
                ? deriveAccountEncryptionCurrentnessFromRow(account)
                : null;
            if (
                currentness?.status !== "ready"
                || !artifactDataKeyMatchesAccountMode({
                    mode: currentness.currentness.encryptionMode,
                    dataEncryptionKey: artifact.dataEncryptionKey,
                })
            ) {
                return { ok: false, error: "internal" };
            }

            if (params.expectedRevision && (artifact.headerVersion !== params.expectedRevision.headerVersion
                || artifact.bodyVersion !== params.expectedRevision.bodyVersion)) {
                return { ok: false as const, error: 'version-mismatch' as const };
            }
            const audience = artifact.deletedAt ? [actorUserId] : await resolveArtifactAudienceInTx(tx, artifactId);
            let cursor: Cursor | undefined;
            // Write changes while the FK target still exists; deletion nulls the
            // projection link, retaining the entity id for a removal refresh.
            for (const accountId of audience) {
                const recipientCursor = await markAccountChanged(tx, { accountId, kind: "artifact", entityId: artifactId });
                if (accountId === actorUserId) cursor = recipientCursor;
            }
            if (cursor === undefined) throw new Error("Artifact owner is missing from its authorized audience");
            const deletedAt = artifact.deletedAt ?? new Date();
            if (!artifact.deletedAt) {
                const retired = await tx.artifact.updateMany({ where: {
                    id: artifactId, accountId: actorUserId, deletedAt: null, ...artifactOrdinaryWhere,
                    headerVersion: artifact.headerVersion, bodyVersion: artifact.bodyVersion,
                }, data: { deletedAt } });
                if (retired.count !== 1) throw new ArtifactDeleteVersionConflictError();
            }
            return { ok: true as const, cursor, deletedAt, artifact };
        });
        if (!retirement.ok) return retirement;
        // Retired rows keep exact custody until every idempotent physical delete succeeds.
        for (const blob of retirement.artifact.blobs) await deletePrivateFile(blob.storageKey);
        return await inTx(async tx => {
            const current = await tx.artifact.findFirst({ where: {
                id: artifactId, accountId: actorUserId, deletedAt: retirement.deletedAt, ...artifactOrdinaryWhere,
                headerVersion: retirement.artifact.headerVersion, bodyVersion: retirement.artifact.bodyVersion,
            }, select: { blobs: { select: { id: true, storageKey: true }, orderBy: { id: 'asc' } } } });
            if (!current || current.blobs.length !== retirement.artifact.blobs.length
                || current.blobs.some((blob, index) => blob.id !== retirement.artifact.blobs[index]?.id
                    || blob.storageKey !== retirement.artifact.blobs[index]?.storageKey)) {
                return { ok: false as const, error: 'internal' as const };
            }
            const removed = await tx.artifact.deleteMany({ where: {
                id: artifactId, accountId: actorUserId, deletedAt: retirement.deletedAt,
                headerVersion: retirement.artifact.headerVersion, bodyVersion: retirement.artifact.bodyVersion,
            } });
            return removed.count === 1 ? { ok: true as const, cursor: retirement.cursor }
                : { ok: false as const, error: 'internal' as const };
        });
    } catch (error) {
        if (error instanceof ArtifactDeleteVersionConflictError) return { ok: false, error: "version-mismatch" };
        return { ok: false, error: "internal" };
    }
}
