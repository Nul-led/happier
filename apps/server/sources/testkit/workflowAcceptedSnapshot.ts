import {
    materializeWorkflowAcceptedSnapshotV1,
    type MaterializeWorkflowAcceptedSnapshotV1Input,
    type WorkflowAcceptedSnapshotV1,
} from "@happier-dev/protocol/workflows";

/** Freeze test programs through admission; machine availability is the external boundary. */
export async function materializeWorkflowAcceptedSnapshotFixture(
    input: Pick<MaterializeWorkflowAcceptedSnapshotV1Input, "definition" | "context">,
): Promise<WorkflowAcceptedSnapshotV1> {
    const accepted = await materializeWorkflowAcceptedSnapshotV1({
        ...input,
        admission: { kind: "user" },
        effects: { resolveTargetAvailability: async () => true },
    });
    if (!accepted.ok) throw new Error(`workflow_fixture_not_materialized:${accepted.error.code}`);
    return accepted.snapshot;
}
