import * as React from 'react';

import { sessionScmLogList } from '@/sync/ops';
import { usePagedScmCommitHistory } from '@/scm/history/usePagedScmCommitHistory';

export function useScmCommitHistory(input: {
    sessionId: string;
    serverId?: string;
    readLogEnabled: boolean;
    sessionPath: string | null;
    historyBranch?: string | null;
}) {
    return usePagedScmCommitHistory({
        enabled: input.readLogEnabled,
        historyIdentity: JSON.stringify([input.sessionId, input.serverId, input.sessionPath, input.historyBranch ?? null]),
        loadPage: React.useCallback(async ({ limit, skip }) => {
            return await sessionScmLogList(input.sessionId, { limit, skip }, input.serverId);
        }, [input.sessionId, input.serverId]),
    });
}
