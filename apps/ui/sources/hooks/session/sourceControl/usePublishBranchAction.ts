import * as React from 'react';

import { useScmPublishBranchAction } from '@/hooks/sourceControl/useScmPublishBranchAction';
import { scmStatusSync } from '@/scm/scmStatusSync';
import { runScmOperationWithGitIndexLockRecovery } from '@/scm/operations/gitIndexLockRecovery';
import { sessionScmRemotePublish, sessionScmRepositoryRemoveIndexLock } from '@/sync/ops';
import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';

type UsePublishBranchActionInput = Readonly<{
    sessionId?: string;
    serverId?: string;
    snapshot?: ScmWorkingSnapshot | null;
    writeEnabled?: boolean;
    disabled?: boolean;
}>;

type UsePublishBranchActionResult = Readonly<{
    canPublish: boolean;
    publishBusy: boolean;
    publishBranch: () => Promise<boolean>;
}>;

// Shared publish-branch action so all SCM surfaces use the same capability gate, mutation flow, and error handling.
export function usePublishBranchAction(input: UsePublishBranchActionInput): UsePublishBranchActionResult {
    const serverId = input.serverId;
    const sessionId = React.useMemo(() => (typeof input.sessionId === 'string' ? input.sessionId.trim() : ''), [input.sessionId, input.serverId]);
    const repoPath = typeof input.snapshot?.repo.rootPath === 'string' && input.snapshot.repo.rootPath.trim().length > 0
        ? input.snapshot.repo.rootPath
        : null;
    const executePublish = React.useCallback((remote: string) => {
        const publish = () => sessionScmRemotePublish(sessionId, { remote }, serverId);
        return publish().then(async (response) => {
            if (response.success || !repoPath) return response;
            return await runScmOperationWithGitIndexLockRecovery({
                cwd: repoPath,
                failedResponse: response,
                removeIndexLock: (request) => sessionScmRepositoryRemoveIndexLock(sessionId, request, serverId),
                retryOriginalOperation: publish,
            });
        });
    }, [repoPath, sessionId, serverId]);
    const refreshAfterPublish = React.useCallback(() => {
        return scmStatusSync.invalidateFromMutationAndAwait(sessionId, serverId);
    }, [sessionId, serverId]);

    return useScmPublishBranchAction({
        actionTargetId: JSON.stringify([serverId, sessionId]),
        snapshot: input.snapshot,
        writeEnabled: input.writeEnabled,
        disabled: input.disabled,
        executePublish,
        refreshAfterPublish,
    });
}
