import type { AuthTokenAuthenticationEvidenceV1 } from "@happier-dev/protocol";

import {
    qualifyTeamAuthenticationInTx,
    type TeamAuthenticationQualificationV1,
} from "@/app/auth/entry/qualifyTeamAuthentication";
import type { Tx } from "@/storage/inTx";
import type { Socket } from "socket.io";
import type { VerifiedEphemeralSessionRunnerPrincipal } from "@happier-dev/protocol/ephemeralRunner/principal";

export type SessionAccessAuthentication = Readonly<{
    env: NodeJS.ProcessEnv;
    authority: "present_user" | "account_automation";
    authenticationEvidence: readonly AuthTokenAuthenticationEvidenceV1[] | undefined;
    sessionRuntimePrincipal?: VerifiedEphemeralSessionRunnerPrincipal;
}>;

/** Exact request credential context stamped by the central authentication decorator. */
export function readSessionAccessAuthenticationFromRequest(request: Readonly<{
    authAuthority?: "present_user" | "account_automation";
    authTokenAuthenticationEvidence?: readonly AuthTokenAuthenticationEvidenceV1[];
    sessionRuntimePrincipal?: VerifiedEphemeralSessionRunnerPrincipal;
}>): SessionAccessAuthentication {
    if (!request.authAuthority) {
        throw new Error("Verified request authentication authority is unavailable");
    }
    return {
        env: process.env,
        authority: request.authAuthority,
        authenticationEvidence: request.authTokenAuthenticationEvidence,
        ...(request.sessionRuntimePrincipal
            ? { sessionRuntimePrincipal: request.sessionRuntimePrincipal }
            : {}),
    };
}

/** Exact credential facts captured at this socket's latest authenticated admission. */
export function readSessionAccessAuthenticationFromSocket(socket: Pick<Socket, "data">): SessionAccessAuthentication {
    if (!socket.data.authAuthority) {
        throw new Error("Verified socket authentication authority is unavailable");
    }
    const admission = (socket.data as Readonly<{
        ephemeralRunnerAdmission?: Readonly<{ principal?: VerifiedEphemeralSessionRunnerPrincipal }>;
    }>).ephemeralRunnerAdmission;
    return {
        env: process.env,
        authority: admission?.principal ? "account_automation" : socket.data.authAuthority,
        authenticationEvidence: socket.data.authTokenAuthenticationEvidence,
        ...(admission?.principal ? { sessionRuntimePrincipal: admission.principal } : {}),
    };
}

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

export async function qualifySessionTeamAuthenticationInTx(
    tx: Tx,
    input: Readonly<{
        accountId: string;
        team: Readonly<{ id: string; authenticationPolicy: unknown }>;
        authentication: SessionAccessAuthentication;
    }>,
): Promise<TeamAuthenticationQualificationV1> {
    const authentication = input.authentication;
    return qualifyTeamAuthenticationInTx(tx, {
        env: authentication.env,
        team: input.team,
        accountId: input.accountId,
        verifiedCredentialEvidence: authentication.authenticationEvidence,
        operationContext: { kind: authentication.authority },
    });
}
