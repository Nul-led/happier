import type { AuthTokenAuthenticationEvidenceV1 } from "@happier-dev/protocol";

import { parseAuthenticationEvidenceSnapshot } from "@/app/auth/authenticationEvidence";
import type { SessionAccessAuthentication } from "@/app/session/access/sessionAccessAuthentication";

type ActivationAuthenticationRecord = Readonly<{ authenticationEvidence: unknown }>;

/**
 * Reads the server-owned credential snapshot for one exact activation.
 * Invalid or absent persisted data is an unqualified automation credential,
 * never a reason to infer evidence from the caller currently observing it.
 */
export function readRunnerActivationAuthenticationEvidence(
    row: ActivationAuthenticationRecord,
): readonly AuthTokenAuthenticationEvidenceV1[] | undefined {
    return parseAuthenticationEvidenceSnapshot(row.authenticationEvidence)?.evidence;
}

export function readRunnerActivationAuthentication(
    row: ActivationAuthenticationRecord,
    env: NodeJS.ProcessEnv,
): SessionAccessAuthentication {
    return {
        env,
        authority: "account_automation",
        authenticationEvidence: readRunnerActivationAuthenticationEvidence(row),
    };
}
