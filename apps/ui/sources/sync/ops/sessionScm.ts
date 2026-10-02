import type {
    ScmBranchCheckoutRequest,
    ScmBranchCheckoutResponse,
    ScmBranchCreateRequest,
    ScmBranchCreateResponse,
    ScmBranchIntegrationRequest,
    ScmBranchIntegrationResponse,
    ScmBranchListRequest,
    ScmBranchListResponse,
    ScmBranchOperationControlRequest,
    ScmConflictAcceptSideRequest,
    ScmConflictMarkResolvedRequest,
    ScmChangeApplyRequest,
    ScmChangeApplyResponse,
    ScmChangeDiscardRequest,
    ScmChangeDiscardResponse,
    ScmCommitBackoutRequest,
    ScmCommitBackoutResponse,
    ScmCommitCreateRequest,
    ScmCommitCreateResponse,
    ScmCommitUndoLastRequest,
    ScmCommitUndoLastResponse,
    ScmDiffCommitRequest,
    ScmDiffCommitResponse,
    ScmDiffFileRequest,
    ScmDiffFileResponse,
    ScmLogListRequest,
    ScmLogListResponse,
    ScmPullRequestGetRequest,
    ScmPullRequestGetResponse,
    ScmPullRequestListRequest,
    ScmPullRequestListResponse,
    ScmPullRequestOpenComposeRequest,
    ScmPullRequestOpenComposeResponse,
    ScmPullRequestOpenOrReuseRequest,
    ScmPullRequestOpenOrReuseResponse,
    ScmRemoteAddRequest,
    ScmRemoteManagementResponse,
    ScmRemotePublishRequest,
    ScmRemotePublishResponse,
    ScmRemoteRemoveRequest,
    ScmRemoteRequest,
    ScmRemoteResponse,
    ScmRemoteSetUrlRequest,
    ScmHostingRepositoryDescribePublishTargetsRequest,
    ScmHostingRepositoryDescribePublishTargetsResponse,
    ScmHostingRepositoryPublishRequest,
    ScmHostingRepositoryPublishResponse,
    ScmRepositoryInitRequest,
    ScmRepositoryInitResponse,
    ScmRepositoryRemoveIndexLockRequest,
    ScmRepositoryRemoveIndexLockResponse,
    ScmStashApplyRequest,
    ScmStashApplyResponse,
    ScmStashDropRequest,
    ScmStashCreateRequest,
    ScmStashCreateResponse,
    ScmStashDropResponse,
    ScmStashListRequest,
    ScmStashListResponse,
    ScmStashPopRequest,
    ScmStashPopResponse,
    ScmStashShowRequest,
    ScmStashShowResponse,
    ScmStatusSnapshotRequest,
    ScmStatusSnapshotTransportResponse,
} from '@happier-dev/protocol/scm';
import { SCM_OPERATION_ERROR_CODES } from '@happier-dev/protocol/scm';
import { RPC_ERROR_MESSAGES, RPC_METHODS } from '@happier-dev/protocol/rpc';

import { runMachineScmRpcWithFallback } from './scm/machineScm';
import type { ScmRpcFailure } from './scm/scmRpcFailure';
import { resolveMachineAbsolutePath } from '@/sync/domains/fileSystem/resolveMachineAbsolutePath';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import { readMachineControlTargetForSession } from './sessionMachineTarget';

async function callScmPreferMachine<
    T extends { success: boolean; error?: string; errorCode?: string },
    R extends { cwd?: string; backendPreference?: unknown }
>(
    sessionId: string,
    method: string,
    request: R,
    serverId?: string | null,
    signal?: AbortSignal,
    accountId?: string | null,
    bindResolvedRequest?: (request: R & { cwd: string }) => R & { cwd: string },
): Promise<T | ScmRpcFailure> {
    const machineTarget = readMachineControlTargetForSession(
        serverId === undefined ? sessionId : { sessionId, serverId: serverId ?? '', ...(accountId ? { accountId } : {}) },
    );

    if (!machineTarget) {
        return {
            success: false,
            error: RPC_ERROR_MESSAGES.METHOD_NOT_AVAILABLE,
            errorCode: SCM_OPERATION_ERROR_CODES.BACKEND_UNAVAILABLE,
        };
    }

    const cwd = resolveMachineAbsolutePath({
        rootPath: machineTarget.basePath,
        agentRootPath: machineTarget.agentBasePath,
        requestPath: request.cwd,
    });
    const resolvedServerId = serverId === undefined
        ? resolvePreferredServerIdForSessionId(sessionId)
        : serverId;
    const payload = bindResolvedRequest ? bindResolvedRequest({ ...request, cwd }) : { ...request, cwd };
    return await runMachineScmRpcWithFallback<T, R>(
        machineTarget.machineId,
        method,
        payload,
        { serverId: resolvedServerId, ...(signal ? { signal } : {}), ...(accountId ? { accountId } : {}) },
    );
}

// Actions and typed facades share the exact session target/path transport owner.
export { callScmPreferMachine as runSessionScmRpc };

export async function sessionScmStatusSnapshot(
    sessionId: string,
    request: ScmStatusSnapshotRequest,
    serverId?: string | null,
): Promise<ScmStatusSnapshotTransportResponse> {
    return await callScmPreferMachine<ScmStatusSnapshotTransportResponse, ScmStatusSnapshotRequest>(
        sessionId,
        RPC_METHODS.SCM_STATUS_SNAPSHOT,
        request,
        serverId,
    );
}

export async function sessionScmDiffFile(
    sessionId: string,
    request: ScmDiffFileRequest,
    serverId?: string | null,
): Promise<ScmDiffFileResponse> {
    return await callScmPreferMachine<ScmDiffFileResponse, ScmDiffFileRequest>(
        sessionId,
        RPC_METHODS.SCM_DIFF_FILE,
        request,
        serverId,
    );
}

export async function sessionScmDiffCommit(
    sessionId: string,
    request: ScmDiffCommitRequest,
    serverId?: string | null,
): Promise<ScmDiffCommitResponse> {
    return await callScmPreferMachine<ScmDiffCommitResponse, ScmDiffCommitRequest>(
        sessionId,
        RPC_METHODS.SCM_DIFF_COMMIT,
        request,
        serverId,
    );
}

export async function sessionScmChangeInclude(
    sessionId: string,
    request: ScmChangeApplyRequest,
    serverId?: string | null,
): Promise<ScmChangeApplyResponse> {
    return await callScmPreferMachine<ScmChangeApplyResponse, ScmChangeApplyRequest>(
        sessionId,
        RPC_METHODS.SCM_CHANGE_INCLUDE,
        request,
        serverId,
    );
}

export async function sessionScmChangeExclude(
    sessionId: string,
    request: ScmChangeApplyRequest,
    serverId?: string | null,
): Promise<ScmChangeApplyResponse> {
    return await callScmPreferMachine<ScmChangeApplyResponse, ScmChangeApplyRequest>(
        sessionId,
        RPC_METHODS.SCM_CHANGE_EXCLUDE,
        request,
        serverId,
    );
}

export async function sessionScmChangeDiscard(
    sessionId: string,
    request: ScmChangeDiscardRequest,
    serverId?: string | null,
): Promise<ScmChangeDiscardResponse> {
    return await callScmPreferMachine<ScmChangeDiscardResponse, ScmChangeDiscardRequest>(
        sessionId,
        RPC_METHODS.SCM_CHANGE_DISCARD,
        request,
        serverId,
    );
}

export async function sessionScmCommitCreate(
    sessionId: string,
    request: ScmCommitCreateRequest,
    serverId?: string | null,
): Promise<ScmCommitCreateResponse> {
    return await callScmPreferMachine<ScmCommitCreateResponse, ScmCommitCreateRequest>(
        sessionId,
        RPC_METHODS.SCM_COMMIT_CREATE,
        request,
        serverId,
    );
}

export async function sessionScmCommitUndoLast(
    sessionId: string,
    request: ScmCommitUndoLastRequest,
    serverId?: string | null,
): Promise<ScmCommitUndoLastResponse> {
    return await callScmPreferMachine<ScmCommitUndoLastResponse, ScmCommitUndoLastRequest>(
        sessionId,
        RPC_METHODS.SCM_COMMIT_UNDO_LAST,
        request,
        serverId,
    );
}

export async function sessionScmLogList(
    sessionId: string,
    request: ScmLogListRequest,
    serverId?: string | null,
): Promise<ScmLogListResponse> {
    return await callScmPreferMachine<ScmLogListResponse, ScmLogListRequest>(
        sessionId,
        RPC_METHODS.SCM_LOG_LIST,
        request,
        serverId,
    );
}

export async function sessionScmCommitBackout(
    sessionId: string,
    request: ScmCommitBackoutRequest,
    serverId?: string | null,
): Promise<ScmCommitBackoutResponse> {
    return await callScmPreferMachine<ScmCommitBackoutResponse, ScmCommitBackoutRequest>(
        sessionId,
        RPC_METHODS.SCM_COMMIT_BACKOUT,
        request,
        serverId,
    );
}

export async function sessionScmRemoteFetch(
    sessionId: string,
    request: ScmRemoteRequest,
    serverId?: string | null,
): Promise<ScmRemoteResponse> {
    return await callScmPreferMachine<ScmRemoteResponse, ScmRemoteRequest>(
        sessionId,
        RPC_METHODS.SCM_REMOTE_FETCH,
        request,
        serverId,
    );
}

export async function sessionScmRemotePush(
    sessionId: string,
    request: ScmRemoteRequest,
    serverId?: string | null,
): Promise<ScmRemoteResponse> {
    return await callScmPreferMachine<ScmRemoteResponse, ScmRemoteRequest>(
        sessionId,
        RPC_METHODS.SCM_REMOTE_PUSH,
        request,
        serverId,
    );
}

export async function sessionScmRemotePull(
    sessionId: string,
    request: ScmRemoteRequest,
    serverId?: string | null,
): Promise<ScmRemoteResponse> {
    return await callScmPreferMachine<ScmRemoteResponse, ScmRemoteRequest>(
        sessionId,
        RPC_METHODS.SCM_REMOTE_PULL,
        request,
        serverId,
    );
}

export async function sessionScmBranchList(
    sessionId: string,
    request: ScmBranchListRequest,
    serverId?: string | null,
): Promise<ScmBranchListResponse> {
    return await callScmPreferMachine<ScmBranchListResponse, ScmBranchListRequest>(
        sessionId,
        RPC_METHODS.SCM_BRANCH_LIST,
        request,
        serverId,
    );
}

export async function sessionScmBranchCreate(
    sessionId: string,
    request: ScmBranchCreateRequest,
    serverId?: string | null,
): Promise<ScmBranchCreateResponse> {
    return await callScmPreferMachine<ScmBranchCreateResponse, ScmBranchCreateRequest>(
        sessionId,
        RPC_METHODS.SCM_BRANCH_CREATE,
        request,
        serverId,
    );
}

export async function sessionScmBranchCheckout(
    sessionId: string,
    request: ScmBranchCheckoutRequest,
    serverId?: string | null,
): Promise<ScmBranchCheckoutResponse> {
    return await callScmPreferMachine<ScmBranchCheckoutResponse, ScmBranchCheckoutRequest>(
        sessionId,
        RPC_METHODS.SCM_BRANCH_CHECKOUT,
        request,
        serverId,
    );
}

export async function sessionScmBranchMerge(
    sessionId: string,
    request: ScmBranchIntegrationRequest,
    serverId?: string | null,
): Promise<ScmBranchIntegrationResponse> {
    return await callScmPreferMachine<ScmBranchIntegrationResponse, ScmBranchIntegrationRequest>(
        sessionId,
        RPC_METHODS.SCM_BRANCH_MERGE,
        request,
        serverId,
    );
}

export async function sessionScmBranchRebase(
    sessionId: string,
    request: ScmBranchIntegrationRequest,
    serverId?: string | null,
): Promise<ScmBranchIntegrationResponse> {
    return await callScmPreferMachine<ScmBranchIntegrationResponse, ScmBranchIntegrationRequest>(
        sessionId,
        RPC_METHODS.SCM_BRANCH_REBASE,
        request,
        serverId,
    );
}

export async function sessionScmBranchOperationContinue(
    sessionId: string,
    request: ScmBranchOperationControlRequest,
    serverId?: string | null,
): Promise<ScmBranchIntegrationResponse> {
    return await callScmPreferMachine<ScmBranchIntegrationResponse, ScmBranchOperationControlRequest>(
        sessionId,
        RPC_METHODS.SCM_BRANCH_OPERATION_CONTINUE,
        request,
        serverId,
    );
}

export async function sessionScmBranchOperationAbort(
    sessionId: string,
    request: ScmBranchOperationControlRequest,
    serverId?: string | null,
): Promise<ScmBranchIntegrationResponse> {
    return await callScmPreferMachine<ScmBranchIntegrationResponse, ScmBranchOperationControlRequest>(
        sessionId,
        RPC_METHODS.SCM_BRANCH_OPERATION_ABORT,
        request,
        serverId,
    );
}

export async function sessionScmBranchOperationSkip(sessionId: string, request: ScmBranchOperationControlRequest, serverId?: string | null): Promise<ScmBranchIntegrationResponse> {
    return callScmPreferMachine(sessionId, RPC_METHODS.SCM_BRANCH_OPERATION_SKIP, request, serverId);
}

export async function sessionScmConflictAcceptSide(sessionId: string, request: ScmConflictAcceptSideRequest, serverId?: string | null): Promise<ScmBranchIntegrationResponse> {
    return callScmPreferMachine(sessionId, RPC_METHODS.SCM_CONFLICT_ACCEPT_SIDE, request, serverId);
}

export async function sessionScmConflictMarkResolved(sessionId: string, request: ScmConflictMarkResolvedRequest, serverId?: string | null): Promise<ScmBranchIntegrationResponse> {
    return callScmPreferMachine(sessionId, RPC_METHODS.SCM_CONFLICT_MARK_RESOLVED, request, serverId);
}

export async function sessionScmRemotePublish(
    sessionId: string,
    request: ScmRemotePublishRequest,
    serverId?: string | null,
): Promise<ScmRemotePublishResponse> {
    return await callScmPreferMachine<ScmRemotePublishResponse, ScmRemotePublishRequest>(
        sessionId,
        RPC_METHODS.SCM_REMOTE_PUBLISH,
        request,
        serverId,
    );
}

export async function sessionScmRemoteAdd(
    sessionId: string,
    request: ScmRemoteAddRequest,
    serverId?: string | null,
): Promise<ScmRemoteManagementResponse> {
    return await callScmPreferMachine<ScmRemoteManagementResponse, ScmRemoteAddRequest>(
        sessionId,
        RPC_METHODS.SCM_REMOTE_ADD,
        request,
        serverId,
    );
}

export async function sessionScmRemoteSetUrl(
    sessionId: string,
    request: ScmRemoteSetUrlRequest,
    serverId?: string | null,
): Promise<ScmRemoteManagementResponse> {
    return await callScmPreferMachine<ScmRemoteManagementResponse, ScmRemoteSetUrlRequest>(
        sessionId,
        RPC_METHODS.SCM_REMOTE_SET_URL,
        request,
        serverId,
    );
}

export async function sessionScmRemoteRemove(
    sessionId: string,
    request: ScmRemoteRemoveRequest,
    serverId?: string | null,
): Promise<ScmRemoteManagementResponse> {
    return await callScmPreferMachine<ScmRemoteManagementResponse, ScmRemoteRemoveRequest>(
        sessionId,
        RPC_METHODS.SCM_REMOTE_REMOVE,
        request,
        serverId,
    );
}

export async function sessionScmPullRequestList(
    sessionId: string,
    request: ScmPullRequestListRequest,
    serverId?: string | null,
): Promise<ScmPullRequestListResponse> {
    return await callScmPreferMachine<ScmPullRequestListResponse, ScmPullRequestListRequest>(
        sessionId,
        RPC_METHODS.SCM_PULL_REQUEST_LIST,
        request,
        serverId,
    );
}

export async function sessionScmPullRequestGet(
    sessionId: string,
    request: ScmPullRequestGetRequest,
    serverId?: string | null,
): Promise<ScmPullRequestGetResponse> {
    return await callScmPreferMachine<ScmPullRequestGetResponse, ScmPullRequestGetRequest>(
        sessionId,
        RPC_METHODS.SCM_PULL_REQUEST_GET,
        request,
        serverId,
    );
}

export async function sessionScmPullRequestOpenCompose(
    sessionId: string,
    request: ScmPullRequestOpenComposeRequest,
    serverId?: string | null,
): Promise<ScmPullRequestOpenComposeResponse> {
    return await callScmPreferMachine<ScmPullRequestOpenComposeResponse, ScmPullRequestOpenComposeRequest>(
        sessionId,
        RPC_METHODS.SCM_PULL_REQUEST_OPEN_COMPOSE,
        request,
        serverId,
    );
}

export async function sessionScmPullRequestOpenOrReuse(
    sessionId: string,
    request: ScmPullRequestOpenOrReuseRequest,
    serverId?: string | null,
): Promise<ScmPullRequestOpenOrReuseResponse> {
    return await callScmPreferMachine<ScmPullRequestOpenOrReuseResponse, ScmPullRequestOpenOrReuseRequest>(
        sessionId,
        RPC_METHODS.SCM_PULL_REQUEST_OPEN_OR_REUSE,
        request,
        serverId,
    );
}

export async function sessionScmRepositoryInit(
    sessionId: string,
    request: ScmRepositoryInitRequest,
    serverId?: string | null,
): Promise<ScmRepositoryInitResponse> {
    return await callScmPreferMachine<ScmRepositoryInitResponse, ScmRepositoryInitRequest>(
        sessionId,
        RPC_METHODS.SCM_REPOSITORY_INIT,
        request,
        serverId,
    );
}

export async function sessionScmHostingRepositoryDescribePublishTargets(
    sessionId: string,
    request: ScmHostingRepositoryDescribePublishTargetsRequest,
    serverId?: string | null,
): Promise<ScmHostingRepositoryDescribePublishTargetsResponse> {
    return await callScmPreferMachine<ScmHostingRepositoryDescribePublishTargetsResponse, ScmHostingRepositoryDescribePublishTargetsRequest>(
        sessionId,
        RPC_METHODS.SCM_HOSTING_REPOSITORY_DESCRIBE_PUBLISH_TARGETS,
        request,
        serverId,
    );
}

export async function sessionScmHostingRepositoryPublish(
    sessionId: string,
    request: ScmHostingRepositoryPublishRequest,
    serverId?: string | null,
): Promise<ScmHostingRepositoryPublishResponse> {
    return await callScmPreferMachine<ScmHostingRepositoryPublishResponse, ScmHostingRepositoryPublishRequest>(
        sessionId,
        RPC_METHODS.SCM_HOSTING_REPOSITORY_PUBLISH,
        request,
        serverId,
    );
}

export async function sessionScmRepositoryRemoveIndexLock(
    sessionId: string,
    request: ScmRepositoryRemoveIndexLockRequest,
    serverId?: string | null,
): Promise<ScmRepositoryRemoveIndexLockResponse> {
    return await callScmPreferMachine<ScmRepositoryRemoveIndexLockResponse, ScmRepositoryRemoveIndexLockRequest>(
        sessionId,
        RPC_METHODS.SCM_REPOSITORY_REMOVE_INDEX_LOCK,
        request,
        serverId,
    );
}

export async function sessionScmStashList(
    sessionId: string,
    request: ScmStashListRequest,
    serverId?: string | null,
): Promise<ScmStashListResponse> {
    return await callScmPreferMachine<ScmStashListResponse, ScmStashListRequest>(
        sessionId,
        RPC_METHODS.SCM_STASH_LIST,
        request,
        serverId,
    );
}

export async function sessionScmStashCreate(
    sessionId: string,
    request: ScmStashCreateRequest,
    serverId?: string | null,
): Promise<ScmStashCreateResponse> {
    return await callScmPreferMachine<ScmStashCreateResponse, ScmStashCreateRequest>(
        sessionId,
        RPC_METHODS.SCM_STASH_CREATE,
        request,
        serverId,
    );
}

export async function sessionScmStashDrop(
    sessionId: string,
    request: ScmStashDropRequest,
    serverId?: string | null,
): Promise<ScmStashDropResponse> {
    return await callScmPreferMachine<ScmStashDropResponse, ScmStashDropRequest>(
        sessionId,
        RPC_METHODS.SCM_STASH_DROP,
        request,
        serverId,
    );
}

export async function sessionScmStashPop(
    sessionId: string,
    request: ScmStashPopRequest,
    serverId?: string | null,
): Promise<ScmStashPopResponse> {
    return await callScmPreferMachine<ScmStashPopResponse, ScmStashPopRequest>(
        sessionId,
        RPC_METHODS.SCM_STASH_POP,
        request,
        serverId,
    );
}

export async function sessionScmStashApply(
    sessionId: string,
    request: ScmStashApplyRequest,
    serverId?: string | null,
): Promise<ScmStashApplyResponse> {
    return await callScmPreferMachine<ScmStashApplyResponse, ScmStashApplyRequest>(
        sessionId,
        RPC_METHODS.SCM_STASH_APPLY,
        request,
        serverId,
    );
}

export async function sessionScmStashShow(
    sessionId: string,
    request: ScmStashShowRequest,
    serverId?: string | null,
): Promise<ScmStashShowResponse> {
    return await callScmPreferMachine<ScmStashShowResponse, ScmStashShowRequest>(
        sessionId,
        RPC_METHODS.SCM_STASH_SHOW,
        request,
        serverId,
    );
}
