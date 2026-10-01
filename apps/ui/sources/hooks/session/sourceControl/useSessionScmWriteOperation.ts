import * as React from 'react';
import { useSessionProjectScmInFlightOperation, useSessionProjectScmOperationLog } from '@/sync/domains/state/storage';
import { selectScmWriteOperation } from '@/scm/operations/selectScmWriteOperation';

/** The session and workspace Git panes read the existing project SCM operation owner through this projection. */
export function useSessionScmWriteOperation(input: Readonly<{
    sessionId: string;
    serverId?: string;
    machine?: string;
    provider?: string;
    machineReachable: boolean;
}>) {
    const inFlight = useSessionProjectScmInFlightOperation(input.sessionId, input.serverId);
    const log = useSessionProjectScmOperationLog(input.sessionId, input.serverId);
    return React.useMemo(() => selectScmWriteOperation({
        inFlight, log,
        machineReachable: input.machineReachable,
        ...(input.machine ? { machine: input.machine } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
    }), [inFlight, log, input.machine, input.provider, input.machineReachable]);
}
