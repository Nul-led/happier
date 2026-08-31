import {
    DeleteWorkspaceSyncConflictLoserV1Schema,
    ReadWorkspaceSyncFileResultV1Schema,
    ReadWorkspaceSyncFileV1Schema,
    WorkspaceSyncConflictListV1Schema,
    WorkspaceSyncRelationshipIdV1Schema,
    WorkspaceSyncStatusV1Schema,
    type DeleteWorkspaceSyncConflictLoserV1,
    type ReadWorkspaceSyncFileResultV1,
    type ReadWorkspaceSyncFileV1,
    type WorkspaceSyncConflictListV1,
    type WorkspaceSyncStatusV1,
} from '@happier-dev/protocol';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import { sync } from '@/sync/sync';
import { storage } from '@/sync/domains/state/storageStore';
import { requireOneShotAccountSettingsMutationApplied } from '@/sync/engine/settings/syncSettings';
import {
    removeWorkspaceSyncRelationshipRecord,
    setWorkspaceSyncRelationshipEnabled,
} from '@/sync/domains/sessionHandoff/workspaceSyncRelationshipMutations';

type WorkspaceSyncControllerScope = Readonly<{
    controllerMachineId: string;
    serverId?: string | null;
    signal?: AbortSignal;
}>;

type WorkspaceSyncRelationshipScope = WorkspaceSyncControllerScope & Readonly<{
    relationshipId: string;
}>;

function unsupported(method: string): never {
    throw new Error(`Unsupported response from machine RPC (${method})`);
}

function strictRecord(value: unknown, keys: readonly string[], method: string): Readonly<Record<string, unknown>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) unsupported(method);
    const record = value as Readonly<Record<string, unknown>>;
    const actualKeys = Object.keys(record);
    if (actualKeys.length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))) {
        unsupported(method);
    }
    return record;
}

async function mutateWorkspaceSyncAccountSettings(
    mutate: (raw: Readonly<Record<string, unknown>>) => Record<string, unknown>,
): Promise<void> {
    const expectedSettingsVersion = storage.getState().settingsVersion;
    if (expectedSettingsVersion === null) {
        throw new Error('Account settings version is unavailable');
    }
    requireOneShotAccountSettingsMutationApplied(
        await sync.mutateAccountSettingsOnce({
            expectedSettingsVersion,
            mutate: (raw) => ({ settings: mutate(raw), value: undefined }),
        }),
    );
}

async function callWorkspaceSync<R>(
    scope: WorkspaceSyncControllerScope,
    method: string,
    payload: unknown,
): Promise<R> {
    return await machineRpcWithServerScope<R, unknown>({
        machineId: scope.controllerMachineId,
        serverId: scope.serverId,
        method,
        payload,
        ...(scope.signal ? { signal: scope.signal } : {}),
    });
}

function parseStatusEnvelope(raw: unknown, method: string): WorkspaceSyncStatusV1 {
    const record = strictRecord(raw, ['status'], method);
    const parsed = WorkspaceSyncStatusV1Schema.safeParse(record.status);
    return parsed.success ? parsed.data : unsupported(method);
}

async function runRelationshipCommand(
    scope: WorkspaceSyncRelationshipScope,
    method: string,
): Promise<WorkspaceSyncStatusV1> {
    const payload = WorkspaceSyncRelationshipIdV1Schema.parse({ relationshipId: scope.relationshipId });
    return parseStatusEnvelope(await callWorkspaceSync(scope, method, payload), method);
}

export async function listWorkspaceSyncStatuses(
    scope: WorkspaceSyncControllerScope,
): Promise<readonly WorkspaceSyncStatusV1[]> {
    const method = RPC_METHODS.DAEMON_WORKSPACE_SYNC_LIST;
    const record = strictRecord(await callWorkspaceSync(scope, method, {}), ['statuses'], method);
    if (!Array.isArray(record.statuses)) unsupported(method);
    const statuses: WorkspaceSyncStatusV1[] = [];
    for (const value of record.statuses) {
        const parsed = WorkspaceSyncStatusV1Schema.safeParse(value);
        if (!parsed.success) unsupported(method);
        statuses.push(parsed.data);
    }
    return statuses;
}

export async function getWorkspaceSyncStatus(
    scope: WorkspaceSyncRelationshipScope,
): Promise<WorkspaceSyncStatusV1 | null> {
    const method = RPC_METHODS.DAEMON_WORKSPACE_SYNC_GET;
    const payload = WorkspaceSyncRelationshipIdV1Schema.parse({ relationshipId: scope.relationshipId });
    const record = strictRecord(await callWorkspaceSync(scope, method, payload), ['status'], method);
    if (record.status === null) return null;
    const parsed = WorkspaceSyncStatusV1Schema.safeParse(record.status);
    return parsed.success ? parsed.data : unsupported(method);
}

export async function flushWorkspaceSyncRelationship(
    scope: WorkspaceSyncRelationshipScope,
): Promise<WorkspaceSyncStatusV1> {
    return await runRelationshipCommand(scope, RPC_METHODS.DAEMON_WORKSPACE_SYNC_FLUSH);
}

async function persistRelationshipEnabled(
    scope: WorkspaceSyncRelationshipScope,
    enabled: boolean,
): Promise<void> {
    const updatedAtMs = Date.now();
    await mutateWorkspaceSyncAccountSettings((raw) => ({
        ...raw,
        workspaceSyncRelationshipsV1: setWorkspaceSyncRelationshipEnabled(
            raw.workspaceSyncRelationshipsV1,
            {
                relationshipId: scope.relationshipId,
                enabled,
                updatedAtMs,
            },
        ),
    }));
}

export async function disableWorkspaceSyncRelationship(
    scope: WorkspaceSyncRelationshipScope,
): Promise<void> {
    await persistRelationshipEnabled(scope, false);
}

export async function enableWorkspaceSyncRelationship(
    scope: WorkspaceSyncRelationshipScope,
): Promise<void> {
    await persistRelationshipEnabled(scope, true);
}

export async function terminatePersistedWorkspaceSyncRelationship(
    scope: WorkspaceSyncRelationshipScope,
): Promise<void> {
    await mutateWorkspaceSyncAccountSettings((raw) => ({
        ...raw,
        workspaceSyncRelationshipsV1: removeWorkspaceSyncRelationshipRecord(
            raw.workspaceSyncRelationshipsV1,
            scope.relationshipId,
        ),
    }));
}

export async function listWorkspaceSyncConflicts(
    scope: WorkspaceSyncRelationshipScope,
): Promise<WorkspaceSyncConflictListV1> {
    const method = RPC_METHODS.DAEMON_WORKSPACE_SYNC_CONFLICTS_LIST;
    const payload = WorkspaceSyncRelationshipIdV1Schema.parse({ relationshipId: scope.relationshipId });
    const parsed = WorkspaceSyncConflictListV1Schema.safeParse(await callWorkspaceSync(scope, method, payload));
    return parsed.success ? parsed.data : unsupported(method);
}

export async function deleteWorkspaceSyncConflictLoser(
    input: WorkspaceSyncControllerScope & Readonly<{ request: DeleteWorkspaceSyncConflictLoserV1 }>,
): Promise<WorkspaceSyncStatusV1> {
    const method = RPC_METHODS.DAEMON_WORKSPACE_SYNC_CONFLICT_DELETE;
    const payload = DeleteWorkspaceSyncConflictLoserV1Schema.parse(input.request);
    return parseStatusEnvelope(await callWorkspaceSync(input, method, payload), method);
}

export async function readWorkspaceSyncFile(
    input: WorkspaceSyncControllerScope & Readonly<{ request: ReadWorkspaceSyncFileV1 }>,
): Promise<ReadWorkspaceSyncFileResultV1> {
    const method = RPC_METHODS.DAEMON_WORKSPACE_SYNC_FILE_READ;
    const payload = ReadWorkspaceSyncFileV1Schema.parse(input.request);
    const parsed = ReadWorkspaceSyncFileResultV1Schema.safeParse(await callWorkspaceSync(input, method, payload));
    return parsed.success ? parsed.data : unsupported(method);
}
