import { Socket } from "socket.io";
import { auth } from "@/app/auth/auth";
import { isRestrictedAuthTokenKind } from "@/app/api/utils/apiTokenRouteAdmission";
import type { RestrictedSocketAdmission } from "./restrictedSocketAdmission";

/**
 * Re-runs the socket's own connect-time credential admission, once, at a socket
 * operation that discloses stored content or durably changes Machine authority.
 *
 * Disclosure handlers run it after their stored-content reads. Machine write
 * handlers run it before opening their transaction because route verification
 * uses the Auth owner's ordinary database reader. The transaction still checks
 * the Machine's current availability and version before writing.
 *
 * Eager eviction stays the revocation mechanism: the committed Account
 * transition disconnects the Account's sockets after commit. These call sites
 * are the ones where a socket that outlived its eviction — a lost cross-node
 * disconnect publication — would still hand back material or move Machine
 * authority, so the same `verifyTokenForRoute` + restricted-kind admission the
 * handshake already performs runs there too. PAT viewer operations also refresh
 * their verified grant here; ordinary sync, fanout and presence pings pay nothing,
 * and no new predicate, generation or ledger exists.
 */
export async function hasCurrentSocketCredential(userId: string, socket: Socket): Promise<boolean> {
    const token = (socket.handshake?.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== "string" || token.length === 0) return false;
    const verified = await auth.verifyTokenForRoute(token);
    if (!verified || verified.userId !== userId) return false;
    if (!isRestrictedAuthTokenKind(verified.authTokenKind)) return true;
    // Same rule as connect: a restricted credential requires an admitted composition.
    const admission = (socket.data as { ephemeralRunnerAdmission?: RestrictedSocketAdmission } | undefined)
        ?.ephemeralRunnerAdmission;
    if (admission?.kind === "api-token-session-viewer") {
        const principal = verified.apiTokenPrincipal;
        if (verified.authTokenKind !== "api_token" || !principal
            || principal.credentialId !== admission.principal.credentialId) return false;
        socket.data.apiTokenPrincipal = principal;
        socket.data.ephemeralRunnerAdmission = { ...admission, principal };
        return true;
    }
    return admission !== undefined && admission !== null;
}
