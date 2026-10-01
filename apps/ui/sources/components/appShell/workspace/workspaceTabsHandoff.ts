import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { AccountKvScopeRetiredError, createAccountKvJsonTransport, type AccountKvJsonSnapshot } from '@/sync/ops/account/accountKvJsonTransport';
import type { ServerFetch } from '@/sync/http/client';
import { getDeviceAnalyticsId } from '@/track/settingsAnalytics/deviceAnalyticsIdentity';
import { AsyncLock } from '@/utils/system/lock';
import type { SharedWorkspaceTabs } from './workspaceSyncedTabs';
import { parseWorkspaceTabs } from './workspaceTabsSync';

export type WorkspaceTabsHandoffSource = Readonly<{ deviceId: string; windowId: string }>;
type HandoffAccountScope = Readonly<{
    credentials: AuthCredentials;
    request: ServerFetch;
    shouldContinue: () => boolean;
}>;
export type WorkspaceTabsHandoffPublisher = Readonly<{
    source: WorkspaceTabsHandoffSource;
    publish: (record: SharedWorkspaceTabs) => Promise<void>;
    stop: () => void;
}>;

export class WorkspaceTabsHandoffSourceUnavailableError extends Error {
    readonly code = 'workspace_handoff_source_unavailable';
    constructor() { super('A device and window identity are required for workspace handoff'); }
}

function handoffKey(source: WorkspaceTabsHandoffSource): string {
    if (!source.deviceId.trim() || !source.windowId.trim()) throw new WorkspaceTabsHandoffSourceUnavailableError();
    return `workspace:handoff-tabs:v1:${encodeURIComponent(source.deviceId)}:${encodeURIComponent(source.windowId)}`;
}

export function createWorkspaceTabsHandoffPublisher(params: HandoffAccountScope & Readonly<{ windowId: string }>): WorkspaceTabsHandoffPublisher {
    const deviceId = getDeviceAnalyticsId();
    if (!deviceId) throw new WorkspaceTabsHandoffSourceUnavailableError();
    const source = { deviceId, windowId: params.windowId };
    let stopped = false;
    let version = -1;
    const shouldContinue = () => !stopped && params.shouldContinue();
    const transport = createAccountKvJsonTransport({ ...params, key: handoffKey(source), shouldContinue });
    const lock = new AsyncLock();
    return {
        source,
        publish: record => lock.inLock(async () => {
            // This source replaces only its own projection. Shared ON-mode intents have another owner.
            const projection = parseWorkspaceTabs(record, version);
            while (shouldContinue()) {
                const result = await transport.compareAndSet(projection, version);
                if (!shouldContinue()) throw new AccountKvScopeRetiredError();
                version = result.version;
                if (result.success) return;
                parseWorkspaceTabs(result.value, result.version, result.tombstone);
            }
            throw new AccountKvScopeRetiredError();
        }),
        stop() { stopped = true; },
    };
}

/** Explicit import reads a named source; preference and shared tabs remain with the workspace owner. */
export async function readWorkspaceTabsHandoff(params: HandoffAccountScope & Readonly<{ source: WorkspaceTabsHandoffSource }>): Promise<AccountKvJsonSnapshot> {
    return await createAccountKvJsonTransport({ ...params, key: handoffKey(params.source) }).read();
}
