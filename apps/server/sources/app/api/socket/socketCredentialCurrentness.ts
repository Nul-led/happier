import { Socket } from "socket.io";
import { auth } from "@/app/auth/auth";
import { isRestrictedAuthTokenKind } from "@/app/api/utils/apiTokenRouteAdmission";
import type { EphemeralRunnerSocketAdmission } from "./ephemeralRunnerSocketAdmission";

/**
 * Re-runs the socket's own connect-time credential admission, once, at a socket
 * operation that discloses stored content or durably changes Machine authority.
 *
 * It runs after the operation's last awaited read and immediately before the
 * disclosure or the write, so verification and effect share one linearization
 * point: a credential that stops being current while the operation's reads are
 * in flight cannot be overtaken by its own result.
 *
 * Eager eviction stays the revocation mechanism: the committed Account
 * transition disconnects the Account's sockets after commit. These call sites
 * are the ones where a socket that outlived its eviction — a lost cross-node
 * disconnect publication — would still hand back material or move Machine
 * authority, so the same `verifyTokenForRoute` + restricted-kind admission the
 * handshake already performs runs there too. Sync, RPC, fanout and presence
 * pings pay nothing, and no new predicate, generation or ledger exists.
 */
export async function hasCurrentSocketCredential(userId: string, socket: Socket): Promise<boolean> {
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
