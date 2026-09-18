import { describe, expect, it } from "vitest";

import { RPC_METHODS } from "@happier-dev/protocol/rpc";

import {
    canEphemeralRunnerMachineRegisterRpcMethod,
    resolveEphemeralRunnerSocketAdmission,
} from "./ephemeralRunnerSocketAdmission";

const principal = {
    kind: "ephemeral_session_runner" as const,
    authority: "session_runtime" as const,
    accountId: "account-13",
    activationId: "10000000-0000-4000-8000-000000000013",
    sessionId: "session-13",
    machineId: "machine-13",
    installationId: "installation-13",
    installationPublicKey: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
    creatorTokenEpoch: 3,
};

describe("resolveEphemeralRunnerSocketAdmission", () => {
    it("admits only the exact bound Session and Machine socket identities", () => {
        expect(resolveEphemeralRunnerSocketAdmission({
            principal,
            clientType: "session-scoped",
            sessionId: principal.sessionId,
            machineId: principal.machineId,
        })).toEqual({ kind: "session-runtime", principal });

        expect(resolveEphemeralRunnerSocketAdmission({
            principal,
            clientType: "machine-scoped",
            machineId: principal.machineId,
        })).toEqual({ kind: "machine-runtime", principal });
    });

    it.each([
        { clientType: "user-scoped", sessionId: principal.sessionId, machineId: principal.machineId },
        { clientType: "session-scoped", sessionId: "other", machineId: principal.machineId },
        { clientType: "session-scoped", sessionId: principal.sessionId, machineId: "other" },
        { clientType: "session-scoped", sessionId: principal.sessionId },
        { clientType: "machine-scoped", machineId: "other" },
        { clientType: "machine-scoped", machineId: principal.machineId, sessionId: principal.sessionId },
    ] as const)("rejects an unbound socket shape %#", (input) => {
        expect(resolveEphemeralRunnerSocketAdmission({ principal, ...input })).toBeNull();
    });

    it("does not turn a missing principal into ordinary authority", () => {
        expect(resolveEphemeralRunnerSocketAdmission({
            principal: null,
            clientType: "session-scoped",
            sessionId: principal.sessionId,
            machineId: principal.machineId,
        })).toBeNull();
    });

    it("allows the exact restricted Machine services and rejects broader registrations", () => {
        const machineAdmission = resolveEphemeralRunnerSocketAdmission({
            principal,
            clientType: "machine-scoped",
            machineId: principal.machineId,
        })!;
        const sessionAdmission = resolveEphemeralRunnerSocketAdmission({
            principal,
            clientType: "session-scoped",
            sessionId: principal.sessionId,
            machineId: principal.machineId,
        })!;

        for (const method of [
            RPC_METHODS.READ_FILE,
            RPC_METHODS.DAEMON_FILESYSTEM_LIST_ROOTS,
            RPC_METHODS.DAEMON_TRANSFER_UPLOAD_INIT,
            RPC_METHODS.DAEMON_TRANSFER_DOWNLOAD_CHUNK,
            RPC_METHODS.DAEMON_SESSION_FOLLOW_SOURCE_KEY_PREPARE,
            RPC_METHODS.STOP_SESSION,
        ]) {
            expect(canEphemeralRunnerMachineRegisterRpcMethod({
                admission: machineAdmission,
                method: `${principal.machineId}:${method}`,
            })).toBe(true);
        }
        expect(canEphemeralRunnerMachineRegisterRpcMethod({
            admission: machineAdmission,
            method: RPC_METHODS.DAEMON_SESSION_FOLLOW_SOURCE_KEY_PREPARE,
        })).toBe(false);
        expect(canEphemeralRunnerMachineRegisterRpcMethod({
            admission: machineAdmission,
            method: `other-machine:${RPC_METHODS.DAEMON_SESSION_FOLLOW_SOURCE_KEY_PREPARE}`,
        })).toBe(false);
        expect(canEphemeralRunnerMachineRegisterRpcMethod({
            admission: machineAdmission,
            method: `${principal.machineId}:${RPC_METHODS.READ_FILE}`,
        })).toBe(true);
        expect(canEphemeralRunnerMachineRegisterRpcMethod({
            admission: machineAdmission,
            method: `${principal.machineId}:${RPC_METHODS.STOP_DAEMON}`,
        })).toBe(false);
        expect(canEphemeralRunnerMachineRegisterRpcMethod({
            admission: machineAdmission,
            method: `${principal.machineId}:unclassified.method`,
        })).toBe(false);
        expect(canEphemeralRunnerMachineRegisterRpcMethod({
            admission: sessionAdmission,
            method: `${principal.machineId}:${RPC_METHODS.DAEMON_SESSION_FOLLOW_SOURCE_KEY_PREPARE}`,
        })).toBe(false);
    });
});
