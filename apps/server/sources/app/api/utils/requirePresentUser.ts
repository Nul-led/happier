import { z } from "zod";
import { PRESENT_USER_REQUIRED_ERROR } from "./apiTokenRouteAdmission";

export { PRESENT_USER_REQUIRED_ERROR } from "./apiTokenRouteAdmission";

export const PresentUserRequiredResponseSchema = z.object({
    error: z.literal(PRESENT_USER_REQUIRED_ERROR),
}).strict();

type AuthenticatedRouteRequest = Readonly<{
    /** Set only by `enableAuthentication`; absent authority fails closed. */
    authAuthority?: unknown;
    /** Current verifier projection; absent or unknown provenance fails closed. */
    authTokenKind?: unknown;
}>;

type AuthenticatedRouteReply = Readonly<{
    code: (statusCode: number) => {
        send: (payload: Readonly<{ error: typeof PRESENT_USER_REQUIRED_ERROR }>) => unknown;
    };
}>;

/**
 * Admits only a credential whose server-verified provenance represents a
 * present interactive user. Authentication itself remains responsible for
 * absent and invalid bearer credentials; this guard deliberately knows only
 * the authority stamped after successful authentication.
 */
export async function requirePresentUser(
    request: AuthenticatedRouteRequest,
    reply: AuthenticatedRouteReply,
): Promise<unknown> {
    // Directory credentials intentionally carry present-user authority for
    // identity operations, but must never reach ordinary Home present-user
    // routes. Authentication stamps this kind on every live request; missing,
    // restricted, and unknown provenance all fail closed.
    if (
        request.authAuthority === "present_user"
        && request.authTokenKind === "account"
    ) return undefined;
    return reply.code(403).send({ error: PRESENT_USER_REQUIRED_ERROR });
}
