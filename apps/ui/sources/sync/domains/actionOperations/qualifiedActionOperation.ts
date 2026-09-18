import type { ActionOperationSnapshotV1 } from '@happier-dev/protocol';

export type ActionOperationAddress = Readonly<{
    serverId: string | null;
    operationId: string;
}>;

export type ActionOperationMachineAddress = Readonly<{
    serverId: string | null;
    machineId: string;
}>;

export type ActionOperationSessionAddress = Readonly<{
    serverId: string | null;
    sessionId: string;
}>;

export type ActionOperationRequestAddress = Readonly<{
    serverId: string | null;
    accountId: string;
    requestId: string;
}>;

export type QualifiedActionOperation = Readonly<{
    serverId: string;
    snapshot: ActionOperationSnapshotV1;
}>;

export function normalizeActionOperationServerId(serverId: string | null | undefined): string | null {
    const normalized = typeof serverId === 'string' ? serverId.trim() : '';
    return normalized || null;
}

export function actionOperationAddress(
    serverId: string | null | undefined,
    operationId: string,
): ActionOperationAddress {
    return Object.freeze({
        serverId: normalizeActionOperationServerId(serverId),
        operationId,
    });
}

export function qualifyActionOperationSnapshot(
    serverId: string,
    snapshot: ActionOperationSnapshotV1,
): QualifiedActionOperation {
    return Object.freeze({
        serverId,
        snapshot,
    });
}

export function actionOperationAddressKey(address: ActionOperationAddress): string {
    return JSON.stringify([normalizeActionOperationServerId(address.serverId), address.operationId]);
}

export function actionOperationMachineAddressKey(address: ActionOperationMachineAddress): string {
    return JSON.stringify([normalizeActionOperationServerId(address.serverId), address.machineId]);
}

export function actionOperationSessionAddressKey(address: ActionOperationSessionAddress): string {
    return JSON.stringify([normalizeActionOperationServerId(address.serverId), address.sessionId]);
}

export function actionOperationRequestAddressKey(address: ActionOperationRequestAddress): string {
    return JSON.stringify([
        normalizeActionOperationServerId(address.serverId),
        address.accountId,
        address.requestId,
    ]);
}

export function isSameActionOperationAddress(
    left: ActionOperationAddress,
    right: ActionOperationAddress,
): boolean {
    return actionOperationAddressKey(left) === actionOperationAddressKey(right);
}
