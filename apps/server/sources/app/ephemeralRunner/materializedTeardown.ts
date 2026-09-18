import { revokeMachineInTx } from "@/app/machines/machineMutations";
import type { Tx } from "@/storage/inTx";

export type MaterializedEphemeralRunnerBinding = Readonly<{
    accountId: string;
    sessionId: string;
    machineId: string;
}>;

/**
 * Identifies retained provenance for one exact materialized Runner binding.
 * This stays transaction-local so the ordinary Session terminal owner can
 * compose cleanup without exposing a parallel activation lifecycle.
 */
export async function readMaterializedEphemeralRunnerBindingStateInTx(
    tx: Tx,
    binding: MaterializedEphemeralRunnerBinding,
): Promise<"current" | "revoked" | "not_runner"> {
    const activation = await tx.ephemeralRunnerActivation.findUnique({
        where: { sessionId: binding.sessionId },
        select: {
            creatorAccountId: true,
            machineId: true,
            state: true,
        },
    });
    if (
        !activation
        || activation.creatorAccountId !== binding.accountId
        || activation.machineId !== binding.machineId
        || activation.state !== "materialized"
    ) return "not_runner";
    const machine = await tx.machine.findFirst({
        where: {
            id: binding.machineId,
            accountId: binding.accountId,
            kind: "ephemeral_session_runner",
        },
        select: { revokedAt: true },
    });
    if (!machine) return "not_runner";
    return machine.revokedAt === null ? "current" : "revoked";
}

/** Revokes the temporary Machine through the canonical Machine mutation owner. */
export async function revokeMaterializedEphemeralRunnerBindingInTx(
    tx: Tx,
    binding: MaterializedEphemeralRunnerBinding,
): Promise<"not_runner" | "revoked"> {
    const state = await readMaterializedEphemeralRunnerBindingStateInTx(tx, binding);
    if (state === "not_runner") return "not_runner";
    const result = await revokeMachineInTx(tx, {
        accountId: binding.accountId,
        machineId: binding.machineId,
    });
    if (!result.ok) throw new Error("Materialized ephemeral Runner Machine disappeared during terminal cleanup");
    return "revoked";
}
