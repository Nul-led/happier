import { Socket } from "socket.io";
import { db } from "@/storage/db";
import { log } from "@/utils/logging/log";
import { auth } from "@/app/auth/auth";
import { isRestrictedAuthTokenKind } from "@/app/api/utils/apiTokenRouteAdmission";
import type { ClientConnection } from "@/app/events/eventPayloadTypes";
import type { EphemeralRunnerSocketAdmission } from "./ephemeralRunnerSocketAdmission";
import { canReadAccessKeyFromSessionScopedSocket } from "./sessionScopedBinding";

/**
 * Re-runs the socket's own connect-time credential admission, once, on the only
 * socket read that returns a stored secret envelope.
 *
 * Eager eviction stays the revocation mechanism: the committed Account
 * transition disconnects the Account's sockets after commit. This is the single
 * place where a socket that outlived its eviction — a lost cross-node
 * disconnect publication — would still hand back material, so the same
 * `verifyTokenForRoute` + restricted-kind admission the handshake and the
 * post-connect check already perform runs here too. No other event pays a
 * verification, and no new predicate, generation or ledger exists.
 */
async function hasCurrentSocketCredential(userId: string, socket: Socket): Promise<boolean> {
    const token = (socket.handshake?.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== "string" || token.length === 0) return false;
    const verified = await auth.verifyTokenForRoute(token);
    if (!verified || verified.userId !== userId) return false;
    if (!isRestrictedAuthTokenKind(verified.authTokenKind)) return true;
    // Same rule as connect: a restricted credential is admitted only on a socket
    // the handshake already admitted as an ephemeral Runner.
    const admission = (socket.data as { ephemeralRunnerAdmission?: EphemeralRunnerSocketAdmission } | undefined)
        ?.ephemeralRunnerAdmission;
    return admission !== undefined && admission !== null;
}

export function accessKeyHandler(userId: string, socket: Socket, connection: ClientConnection) {
    // Get access key via socket
    socket.on('access-key-get', async (data: { sessionId: string; machineId: string }, callback: (response: any) => void) => {
        try {
            const { sessionId, machineId } = data;

            if (!sessionId || !machineId) {
                if (callback) {
                    callback({
                        ok: false,
                        error: 'Invalid parameters: sessionId and machineId are required'
                    });
                }
                return;
            }
            if (!await canReadAccessKeyFromSessionScopedSocket({ socket, connection, sessionId, machineId })) {
                if (callback) {
                    callback({
                        ok: false,
                        error: 'Forbidden'
                    });
                }
                return;
            }
            if (!await hasCurrentSocketCredential(userId, socket)) {
                if (callback) {
                    callback({
                        ok: false,
                        error: 'Forbidden'
                    });
                }
                socket.disconnect(true);
                return;
            }

            // Verify session and machine belong to user
            const [session, machine] = await Promise.all([
                db.session.findFirst({
                    where: { id: sessionId, accountId: userId }
                }),
                db.machine.findFirst({
                    where: { id: machineId, accountId: userId }
                })
            ]);

            if (!session || !machine) {
                if (callback) {
                    callback({
                        ok: false,
                        error: 'Session or machine not found'
                    });
                }
                return;
            }

            // Get access key
            const accessKey = await db.accessKey.findUnique({
                where: {
                    accountId_machineId_sessionId: {
                        accountId: userId,
                        machineId,
                        sessionId
                    }
                }
            });

            if (callback) {
                if (accessKey) {
                    callback({
                        ok: true,
                        accessKey: {
                            data: accessKey.data,
                            dataVersion: accessKey.dataVersion,
                            createdAt: accessKey.createdAt.getTime(),
                            updatedAt: accessKey.updatedAt.getTime()
                        }
                    });
                } else {
                    callback({
                        ok: true,
                        accessKey: null
                    });
                }
            }

            log({ module: 'websocket-access-key' }, `Access key retrieved for session ${sessionId}, machine ${machineId}`);
        } catch (error) {
            log({ module: 'websocket', level: 'error' }, `Error in access-key-get: ${error}`);
            if (callback) {
                callback({
                    ok: false,
                    error: 'Internal error'
                });
            }
        }
    });
}
