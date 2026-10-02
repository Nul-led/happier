import { inTx, type Tx } from "@/storage/inTx";
import { readArtifactStorageEnv } from "@/app/features/catalog/readFeatureEnv";
import { readArtifactForCallerInTx } from "./artifactAccessService";
import { openArtifactStoredContentBytes } from "./artifactStoredContent";
import { updateArtifactTx, type UpdateArtifactResult } from "./artifactWriteService";
import { cleanupArtifactOrphanBlobs } from './artifactBlobService';

/** Reads history under the same current access, mode and recipient envelope admission as the head. */
export async function listArtifactBodyRevisionsInTx(tx: Tx, input: Readonly<{
    actorAccountId: string;
    artifactId: string;
}>) {
    const read = await readArtifactForCallerInTx(tx, input);
    if (!read.ok) return read;
    const revisions = await tx.artifactRevision.findMany({ where: { artifactId: input.artifactId }, orderBy: { bodyVersion: "desc" } });
    const projected = [];
    for (const revision of revisions) {
        const body = openArtifactStoredContentBytes({ accountId: read.artifact.ownerAccountId, artifactId: input.artifactId,
            mode: read.artifact.encryptionMode, field: "body", dataEncryptionKey: read.artifact.dataEncryptionKey, content: revision.body });
        if (!body) return { ok: false as const, error: "artifact_content_unavailable" as const };
        projected.push({ bodyVersion: revision.bodyVersion, body, createdAt: revision.createdAt, sizeBytes: revision.body.byteLength });
    }
    return { ok: true as const, revisions: projected, retentionCount: readArtifactStorageEnv(process.env).revisionRetentionCount };
}

/** Restore the prior body with a caller-prepared current header, atomically advancing both head versions. */
export async function restoreArtifactBodyRevision(input: Readonly<{
    actorUserId: string;
    artifactId: string;
    bodyVersion: number;
    header: Uint8Array;
    expectedRevision: Readonly<{ headerVersion: number; bodyVersion: number }>;
}>): Promise<UpdateArtifactResult> {
    try {
        const result = await inTx<UpdateArtifactResult>(async tx => {
            const read = await readArtifactForCallerInTx(tx, { actorAccountId: input.actorUserId, artifactId: input.artifactId });
            if (!read.ok || read.artifact.access === "view") return { ok: false, error: "not-found" };
            const revision = await tx.artifactRevision.findUnique({ where: {
                artifactId_bodyVersion: { artifactId: input.artifactId, bodyVersion: input.bodyVersion },
            } });
            if (!revision) return { ok: false, error: "not-found" };
            const bytes = openArtifactStoredContentBytes({ accountId: read.artifact.ownerAccountId, artifactId: input.artifactId,
                mode: read.artifact.encryptionMode, field: "body", dataEncryptionKey: read.artifact.dataEncryptionKey, content: revision.body });
            if (!bytes) return { ok: false, error: "internal" };
            return await updateArtifactTx(tx, { actorUserId: input.actorUserId, artifactId: input.artifactId,
                expectedRevision: input.expectedRevision,
                header: { bytes: input.header, expectedVersion: input.expectedRevision.headerVersion },
                body: { bytes, expectedVersion: input.expectedRevision.bodyVersion }, restoredBlobId: revision.blobId });
        });
        if (result.ok) await cleanupArtifactOrphanBlobs(input.artifactId);
        return result;
    } catch {
        return { ok: false, error: "internal" };
    }
}
