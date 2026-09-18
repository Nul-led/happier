import type { VerifiedEphemeralSessionRunnerPrincipal } from "@happier-dev/protocol/ephemeralRunner/principal";
import { resolveEphemeralRunnerMachineRpcAuthority } from "@happier-dev/protocol";

import type { SocketClientType } from "../socketRooms";

export type EphemeralRunnerSocketAdmission =
    | Readonly<{ kind: "session-runtime"; principal: VerifiedEphemeralSessionRunnerPrincipal }>
    | Readonly<{ kind: "machine-runtime"; principal: VerifiedEphemeralSessionRunnerPrincipal }>;

export function canEphemeralRunnerMachineRegisterRpcMethod(params: Readonly<{
    admission: EphemeralRunnerSocketAdmission;
    method: string;
}>): boolean {
    if (params.admission.kind !== "machine-runtime") return false;
    const prefix = `${params.admission.principal.machineId}:`;
    if (!params.method.startsWith(prefix)) return false;
    const method = params.method.slice(prefix.length);
    return resolveEphemeralRunnerMachineRpcAuthority(method) !== null;
}

/**
 * Runner credentials are valid for exactly two existing socket compositions:
 * their materialized Session publisher and their exact ephemeral Machine RPC
 * receiver. Requiring the Machine on the Session socket keeps both transports
 * bound to the materializer's one AccessKey tuple.
 */
export function resolveEphemeralRunnerSocketAdmission(params: Readonly<{
    principal: VerifiedEphemeralSessionRunnerPrincipal | null | undefined;
    clientType: SocketClientType;
    sessionId?: string;
    machineId?: string;
}>): EphemeralRunnerSocketAdmission | null {
    const principal = params.principal;
    if (!principal) return null;

    if (
        params.clientType === "session-scoped"
        && params.sessionId === principal.sessionId
        && params.machineId === principal.machineId
    ) {
        return { kind: "session-runtime", principal };
    }

    if (
        params.clientType === "machine-scoped"
        && params.machineId === principal.machineId
        && params.sessionId === undefined
    ) {
        return { kind: "machine-runtime", principal };
    }

    return null;
}
