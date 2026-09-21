import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";

/**
 * The credential context of background delivery: OS push, the content-free wake
 * and the badge refresh.
 *
 * These legs are produced by a committed server-side event, not by a request, so
 * there is no verified credential evidence to carry. Reading them through the
 * same canonical access owner as every request — rather than through a
 * structural entitlement projection that ignores Team authentication — keeps the
 * owner, direct and inherited-authentication arms delivering exactly as before
 * while a restricted Team admits a recipient only when it currently qualifies
 * with no evidence. What a restricted Team then withholds is delivery metadata
 * (that an event happened, for which Session, and the aggregate badge count);
 * no alert has ever carried Session content.
 *
 * `account_automation` is the honest authority for a server-side leg acting on
 * an Account's behalf: qualification is decided by the presented evidence, and
 * this leg presents none.
 */
export function backgroundDeliveryAuthentication(): SessionAccessAuthentication {
    return {
        env: process.env,
        authority: "account_automation",
        authenticationEvidence: undefined,
    };
}
