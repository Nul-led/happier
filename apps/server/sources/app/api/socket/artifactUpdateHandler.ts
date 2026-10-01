import { websocketEventsCounter } from "@/app/monitoring/metrics/index";
import { buildNewArtifactUpdate, buildUpdateArtifactUpdate, buildDeleteArtifactUpdate, eventRouter } from "@/app/events/eventRouter";
import { inTx } from "@/storage/inTx";
import { log } from "@/utils/logging/log";
import { randomKeyNaked } from "@/utils/keys/randomKeyNaked";
import { Socket } from "socket.io";
import * as privacyKit from "privacy-kit";
import { createArtifact, deleteArtifact, updateArtifact } from "@/app/artifacts/artifactWriteService";
import { readArtifactForCallerInTx } from "@/app/artifacts/artifactAccessService";
import { hasCurrentSocketCredential } from "./socketCredentialCurrentness";

/**
 * Refuses a socket operation whose credential is no longer current and closes
 * the socket, so a connection that outlived its eviction cannot read or mutate
 * Account-owned Artifacts.
 */
function refuseStaleArtifactOperation(socket: Socket, callback?: (response: any) => void): void {
    callback?.({ result: 'error', message: 'Forbidden' });
    socket.disconnect(true);
}

export function artifactUpdateHandler(userId: string, socket: Socket) {
    // Read artifact with full body
    socket.on('artifact-read', async (data: {
        artifactId: string;
    }, callback: (response: any) => void) => {
        try {
            websocketEventsCounter.inc({ event_type: 'artifact-read' });

            const { artifactId } = data;

            // Validate input
            if (!artifactId) {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid parameters' });
                }
                return;
            }

            const read = await inTx(tx => readArtifactForCallerInTx(tx, { actorAccountId: userId, artifactId }));
            if (!read.ok) {
                callback?.({ result: 'error', message: read.error === 'artifact_not_found' ? 'Artifact not found' : 'Internal error' });
                return;
            }
            const artifact = read.artifact;

            // Everything above is read; this is the disclosure. Re-run the
            // socket's own connect-time admission here, after the last await,
            // so a credential that stopped being current mid-read cannot be
            // overtaken by its own result.
            if (!await hasCurrentSocketCredential(userId, socket)) {
                refuseStaleArtifactOperation(socket, callback);
                return;
            }

            // Return artifact data
            callback({
                result: 'success',
                artifact: {
                    id: artifact.id,
                    ownerAccountId: artifact.ownerAccountId,
                    access: artifact.access,
                    encryptionMode: artifact.encryptionMode,
                    dataEncryptionKey: privacyKit.encodeBase64(artifact.dataEncryptionKey),
                    header: privacyKit.encodeBase64(artifact.header),
                    headerVersion: artifact.headerVersion,
                    body: privacyKit.encodeBase64(artifact.body),
                    bodyVersion: artifact.bodyVersion,
                    seq: artifact.seq,
                    createdAt: artifact.createdAt.getTime(),
                    updatedAt: artifact.updatedAt.getTime()
                }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in artifact-read: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });

    // Update artifact with optimistic concurrency control
    socket.on('artifact-update', async (data: {
        artifactId: string;
        header?: {
            data: string;
            expectedVersion: number;
        };
        body?: {
            data: string;
            expectedVersion: number;
        };
    }, callback: (response: any) => void) => {
        try {
            websocketEventsCounter.inc({ event_type: 'artifact-update' });

            const { artifactId, header, body } = data;

            // Validate input
            if (!artifactId) {
                callback?.({ result: 'error', message: 'Invalid parameters' });
                return;
            }

            // At least one update must be provided
            if (!header && !body) {
                callback?.({ result: 'error', message: 'No updates provided' });
                return;
            }

            // Validate header structure if provided
            if (header && (typeof header.data !== 'string' || typeof header.expectedVersion !== 'number')) {
                callback?.({ result: 'error', message: 'Invalid header parameters' });
                return;
            }

            // Validate body structure if provided
            if (body && (typeof body.data !== 'string' || typeof body.expectedVersion !== 'number')) {
                callback?.({ result: 'error', message: 'Invalid body parameters' });
                return;
            }

            if (!await hasCurrentSocketCredential(userId, socket)) {
                refuseStaleArtifactOperation(socket, callback);
                return;
            }
            const result = await updateArtifact({
                actorUserId: userId,
                artifactId,
                header: header ? { bytes: privacyKit.decodeBase64(header.data), expectedVersion: header.expectedVersion } : undefined,
                body: body ? { bytes: privacyKit.decodeBase64(body.data), expectedVersion: body.expectedVersion } : undefined,
            });

            if (!result.ok) {

                if (result.error === 'invalid-params') {
                    callback?.({ result: 'error', message: 'Invalid parameters' });
                    return;
                }
                if (result.error === 'not-found') {
                    callback?.({ result: 'error', message: 'Artifact not found' });
                    return;
                }

                if (result.error === 'version-mismatch') {
                    // This branch hands back the CURRENT stored header and body,
                    // which the caller did not supply — the same disclosure
                    // artifact-read performs, under the same admission.
                    if (!await hasCurrentSocketCredential(userId, socket)) {
                        refuseStaleArtifactOperation(socket, callback);
                        return;
                    }
                    const response: any = { result: 'version-mismatch' };
                    if (header && result.current) {
                        response.header = {
                            currentVersion: result.current.headerVersion,
                            currentData: Buffer.from(result.current.header).toString('base64'),
                        };
                    }
                    if (body && result.current) {
                        response.body = {
                            currentVersion: result.current.bodyVersion,
                            currentData: Buffer.from(result.current.body).toString('base64'),
                        };
                    }
                    callback?.(response);
                    return;
                }

                callback?.({ result: 'error', message: 'Internal error' });
                return;
            }

            const headerUpdate = header && result.header
                ? { value: header.data, version: result.header.version }
                : undefined;
            const bodyUpdate = body && result.body
                ? { value: body.data, version: result.body.version }
                : undefined;

            const legacyRecipient = result.ownerUpdate ?? { accountId: userId, cursor: result.cursor };
            const updatePayload = buildUpdateArtifactUpdate(artifactId, legacyRecipient.cursor, randomKeyNaked(12), headerUpdate, bodyUpdate);
            eventRouter.emitUpdate({
                userId: legacyRecipient.accountId,
                payload: updatePayload,
                recipientFilter: { type: 'user-scoped-only' }
            });

            const response: any = { result: 'success' };
            if (headerUpdate) {
                response.header = { version: headerUpdate.version, data: header!.data };
            }
            if (bodyUpdate) {
                response.body = { version: bodyUpdate.version, data: body!.data };
            }
            callback?.(response);
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in artifact-update: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });

    // Create new artifact
    socket.on('artifact-create', async (data: {
        id: string;
        header: string;
        body: string;
        dataEncryptionKey: string;
    }, callback: (response: any) => void) => {
        try {
            websocketEventsCounter.inc({ event_type: 'artifact-create' });

            const { id, header, body, dataEncryptionKey } = data;

            // Validate input
            if (!id || typeof header !== 'string' || typeof body !== 'string' || typeof dataEncryptionKey !== 'string') {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid parameters' });
                }
                return;
            }

            // Check if artifact already exists

            if (!await hasCurrentSocketCredential(userId, socket)) {
                refuseStaleArtifactOperation(socket, callback);
                return;
            }
            const result = await createArtifact({
                actorUserId: userId,
                artifactId: id,
                header: privacyKit.decodeBase64(header),
                body: privacyKit.decodeBase64(body),
                dataEncryptionKey: privacyKit.decodeBase64(dataEncryptionKey),
            });

            if (!result.ok) {

                if (result.error === 'invalid-params') {
                    callback?.({ result: 'error', message: 'Invalid parameters' });
                    return;
                }
                if (result.error === 'conflict') {
                    // Avoid revealing whether an artifact ID is already owned by another account.
                    callback?.({ result: 'error', message: 'Artifact already exists' });
                    return;
                }
                callback?.({ result: 'error', message: 'Internal error' });
                return;
            }

            if (result.didWrite) {
                const newArtifactPayload = buildNewArtifactUpdate(result.artifact, result.cursor, randomKeyNaked(12));
                eventRouter.emitUpdate({
                    userId,
                    payload: newArtifactPayload,
                    recipientFilter: { type: 'user-scoped-only' }
                });
            }

            // An id this Account already owns is answered with the EXISTING
            // row's content and `didWrite: false` — a read wearing a create's
            // name, so it takes the same admission.
            if (!result.didWrite && !await hasCurrentSocketCredential(userId, socket)) {
                refuseStaleArtifactOperation(socket, callback);
                return;
            }

            callback?.({
                result: 'success',
                artifact: {
                    id: result.artifact.id,
                    header: Buffer.from(result.artifact.header).toString('base64'),
                    headerVersion: result.artifact.headerVersion,
                    body: Buffer.from(result.artifact.body).toString('base64'),
                    bodyVersion: result.artifact.bodyVersion,
                    seq: result.artifact.seq,
                    createdAt: result.artifact.createdAt.getTime(),
                    updatedAt: result.artifact.updatedAt.getTime()
                }
            });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in artifact-create: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });

    // Delete artifact
    socket.on('artifact-delete', async (data: {
        artifactId: string;
    }, callback: (response: any) => void) => {
        try {
            websocketEventsCounter.inc({ event_type: 'artifact-delete' });

            const { artifactId } = data;

            // Validate input
            if (!artifactId) {
                if (callback) {
                    callback({ result: 'error', message: 'Invalid parameters' });
                }
                return;
            }

            if (!await hasCurrentSocketCredential(userId, socket)) {
                refuseStaleArtifactOperation(socket, callback);
                return;
            }
            const result = await deleteArtifact({
                actorUserId: userId,
                artifactId,
            });
            if (!result.ok) {

                if (result.error === 'not-found') {
                    callback?.({ result: 'error', message: 'Artifact not found' });
                    return;
                }
                callback?.({ result: 'error', message: 'Internal error' });
                return;
            }

            const deletePayload = buildDeleteArtifactUpdate(artifactId, result.cursor, randomKeyNaked(12));
            eventRouter.emitUpdate({
                userId,
                payload: deletePayload,
                recipientFilter: { type: 'user-scoped-only' }
            });

            callback?.({ result: 'success' });
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in artifact-delete: ${error}`);
            if (callback) {
                callback({ result: 'error', message: 'Internal error' });
            }
        }
    });
}
