import {
    ACTION_OPERATION_REVISION_EPHEMERAL_EVENT_V1,
    ActionOperationRevisionEphemeralV1Schema,
    ActionOperationSnapshotPushV1Schema,
    isAccountScopedBlobCiphertextForKind,
    type ActionOperationRevisionEphemeralV1,
} from '@happier-dev/protocol';

export function projectActionOperationSnapshotPush(
    raw: unknown,
    authenticatedMachineId: string | null,
): ActionOperationRevisionEphemeralV1 | null {
    const current = ActionOperationSnapshotPushV1Schema.safeParse(raw);
    const released = current.success ? null : ActionOperationRevisionEphemeralV1Schema.safeParse(raw);
    const machineId = current.success ? current.data.machineId : released?.success ? released.data.machineId : null;
    const ciphertext = current.success ? current.data.ciphertext : released?.success ? released.data.content.c : null;
    if (
        !machineId
        || !ciphertext
        || !authenticatedMachineId
        || machineId !== authenticatedMachineId
        || !isAccountScopedBlobCiphertextForKind({
            kind: 'action_operation_snapshot',
            ciphertext,
        })
    ) {
        return null;
    }
    return {
        type: ACTION_OPERATION_REVISION_EPHEMERAL_EVENT_V1,
        machineId: authenticatedMachineId,
        content: { t: 'encrypted', c: ciphertext },
    };
}
