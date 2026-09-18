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
