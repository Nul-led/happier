import * as React from 'react';
import type { SessionListStorageFilter } from '@/sync/domains/session/sessionStorageKind';
import { SessionsListActionRows } from './SessionsListActionRows';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';

export type SessionsListStorageChromeProps = Readonly<{
    externalSessionsEnabled: boolean;
    storageKind: SessionListStorageFilter;
}>;

export const SessionsListStorageChrome = React.memo((props: SessionsListStorageChromeProps) => {
    const scope = captureActiveServerAccountScopeLifetime()?.scope ?? null;
    const universalSearchScope = scope ? {
        accountId: scope.accountId,
        serverId: scope.serverId,
        sessionId: null,
        machineId: null,
        rootPath: null,
    } : undefined;
    return <SessionsListActionRows externalSessionsEnabled={props.externalSessionsEnabled} universalSearchScope={universalSearchScope} />;
});
