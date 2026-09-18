import { describe, expect, it, vi } from 'vitest';
import {
    buildApprovalRequestArtifactHeaderV1,
    type ApprovalRequestV2,
} from '@happier-dev/protocol';

import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';

import {
    createActionApprovalContinuation,
    createHomeActionApprovalContinuation,
} from './actionApprovalContinuation';

const actionId = 'teams.identity.connections.test.start' as const;
const actionInput = {
    v: 1 as const,
    teamId: 'team-1',
    connectionId: 'connection-1',
    expectedRevision: 2,
};
const actionResult = {
    attemptId: 'attempt-1',
    authorizeUrl: 'https://issuer.example.test/authorize',
};

type ReadableArtifact = Extract<DecryptedArtifact, Readonly<{ isDecrypted: true }>>;

function executedArtifact(overrides?: Readonly<{
    artifactId?: string;
    actionId?: ApprovalRequestV2['actionId'];
    actionArgs?: unknown;
    accountId?: string;
    serverId?: string;
    surface?: 'ui' | 'api' | 'cli' | 'plugin';
    requestedSurface?: string;
    requestId?: string;
    result?: unknown;
}>): ReadableArtifact {
    const requestActionId = overrides?.actionId ?? actionId;
    const request: ApprovalRequestV2 = {
        v: 2,
        status: 'executed',
        createdAtMs: 1,
        updatedAtMs: 2,
        createdBy: { surface: 'system' },
        requestedSurface: overrides?.requestedSurface ?? 'ui',
        executionOriginV1: {
            v: 1,
            authority: 'present_user',
            surface: overrides?.surface ?? 'ui',
            caller: { kind: 'host' },
            serverId: overrides?.serverId ?? 'home-1',
            accountId: overrides?.accountId ?? 'account-1',
            actionId: requestActionId,
            requestId: overrides?.requestId ?? 'request-1',
        },
        actionId: requestActionId,
        actionArgs: overrides?.actionArgs ?? actionInput,
        summary: 'Test the Team identity connection',
        decision: { kind: 'approve', decidedAtMs: 2 },
        execution: {
            executedAtMs: 2,
            ok: true,
            result: overrides && 'result' in overrides ? overrides.result : actionResult,
        },
    };
    return {
        id: overrides?.artifactId ?? 'approval-1',
        title: null,
        header: { title: null, ...buildApprovalRequestArtifactHeaderV1(request) },
        body: JSON.stringify(request),
        headerVersion: 1,
        bodyVersion: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 2,
        isDecrypted: true,
    };
}

function failedArtifact(overrides?: Readonly<{
    actionId?: ApprovalRequestV2['actionId'];
    actionArgs?: unknown;
    accountId?: string;
    errorCode?: string;
    error?: string;
    details?: unknown;
}>): ReadableArtifact {
    const requestActionId = overrides?.actionId ?? actionId;
    const request: ApprovalRequestV2 = {
        v: 2,
        status: 'failed',
        createdAtMs: 1,
        updatedAtMs: 2,
        createdBy: { surface: 'system' },
        requestedSurface: 'ui',
        executionOriginV1: {
            v: 1,
            authority: 'present_user',
            surface: 'ui',
            caller: { kind: 'host' },
            serverId: 'home-1',
            accountId: overrides?.accountId ?? 'account-1',
            actionId: requestActionId,
            requestId: 'request-1',
        },
        actionId: requestActionId,
        actionArgs: overrides?.actionArgs ?? actionInput,
        summary: 'Test the Team identity connection',
        decision: { kind: 'approve', decidedAtMs: 2 },
        execution: {
            executedAtMs: 2,
            ok: false,
            errorCode: overrides?.errorCode ?? 'identity_provider_unavailable',
            error: overrides?.error ?? overrides?.errorCode ?? 'identity_provider_unavailable',
            ...(overrides && 'details' in overrides ? { details: overrides.details } : {}),
        },
    };
    return {
        id: 'approval-1',
        title: null,
        header: { title: null, ...buildApprovalRequestArtifactHeaderV1(request) },
        body: JSON.stringify(request),
        headerVersion: 1,
        bodyVersion: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 2,
        isDecrypted: true,
    };
}

describe('createHomeActionApprovalContinuation', () => {
    it('delivers the exact executed result through the canonical Action output schema', async () => {
        const onSucceeded = vi.fn();
        const onFailed = vi.fn();
        const continuation = createHomeActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            onSucceeded,
            onFailed,
        });

        expect(await continuation.onExecuted(executedArtifact())).toBe('consumed');
        expect(onSucceeded).toHaveBeenCalledWith(actionResult);
        expect(onFailed).not.toHaveBeenCalled();
    });

    it('ignores an Artifact with another identity without consuming the exact pending operation', async () => {
        const onSucceeded = vi.fn();
        const onFailed = vi.fn();
        const continuation = createHomeActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            onSucceeded,
            onFailed,
        });

        expect(await continuation.onExecuted(executedArtifact({ artifactId: 'approval-other' }))).toBe('ignored');
        expect(onSucceeded).not.toHaveBeenCalled();
        expect(onFailed).not.toHaveBeenCalled();
    });

    it.each([
        ['wrong Action', executedArtifact({ actionId: 'teams.identity.connections.disable' })],
        ['wrong Account', executedArtifact({ accountId: 'account-other' })],
        ['wrong Home', executedArtifact({ serverId: 'home-other' })],
    ])('fails a same-Artifact %s binding instead of silently losing the result', async (_label, artifact) => {
        const onSucceeded = vi.fn();
        const onFailed = vi.fn();
        const continuation = createHomeActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            onSucceeded,
            onFailed,
        });

        expect(await continuation.onExecuted(artifact)).toBe('consumed');
        expect(onSucceeded).not.toHaveBeenCalled();
        expect(onFailed).toHaveBeenCalledWith('approval_binding_mismatch');
    });

    it('rejects the same Action when the approval belongs to different canonical input', async () => {
        const onSucceeded = vi.fn();
        const onFailed = vi.fn();
        const continuation = createHomeActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            expectedInput: actionInput,
            onSucceeded,
            onFailed,
        });

        expect(await continuation.onExecuted(executedArtifact({
            actionArgs: { ...actionInput, connectionId: 'connection-other' },
        }))).toBe('consumed');
        expect(onSucceeded).not.toHaveBeenCalled();
        expect(onFailed).toHaveBeenCalledWith('approval_binding_mismatch');
    });

    it('rejects the same Action when the approval belongs to another request identity', async () => {
        const onSucceeded = vi.fn();
        const onFailed = vi.fn();
        const continuation = createHomeActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            expectedRequestId: 'request-1',
            onSucceeded,
            onFailed,
        });

        expect(await continuation.onExecuted(executedArtifact({ requestId: 'request-other' }))).toBe('consumed');
        expect(onSucceeded).not.toHaveBeenCalled();
        expect(onFailed).toHaveBeenCalledWith('approval_binding_mismatch');
    });

    it.each([
        ['non-UI origin', executedArtifact({ surface: 'api' })],
        ['non-UI requested surface', executedArtifact({ requestedSurface: 'api' })],
    ])('rejects a structurally contradictory %s artifact as invalid', async (_label, artifact) => {
        const onFailed = vi.fn();
        const continuation = createHomeActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            onSucceeded: vi.fn(),
            onFailed,
        });

        expect(await continuation.onExecuted(artifact)).toBe('consumed');
        expect(onFailed).toHaveBeenCalledWith('approval_invalid');
    });

    it('fails a malformed exact Artifact as invalid', async () => {
        const onFailed = vi.fn();
        const continuation = createHomeActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            onSucceeded: vi.fn(),
            onFailed,
        });
        const artifact = executedArtifact();

        expect(await continuation.onExecuted({ ...artifact, body: '{' })).toBe('consumed');
        expect(onFailed).toHaveBeenCalledWith('approval_invalid');
    });

    it('reports an invalid recorded result without manufacturing success', async () => {
        const onSucceeded = vi.fn();
        const onFailed = vi.fn();
        const continuation = createHomeActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            onSucceeded,
            onFailed,
        });

        expect(await continuation.onExecuted(executedArtifact({ result: { v: 1 } }))).toBe('consumed');
        expect(onSucceeded).not.toHaveBeenCalled();
        expect(onFailed).toHaveBeenCalledWith('invalid_action_output');
    });

    it('preserves the exact failed execution code after validating the same Action binding', () => {
        const onFailed = vi.fn();
        const continuation = createHomeActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            onSucceeded: vi.fn(),
            onFailed,
        });

        continuation.onTerminal?.('failed', failedArtifact());
        expect(onFailed).toHaveBeenCalledWith('identity_provider_unavailable', {
            ok: false,
            errorCode: 'identity_provider_unavailable',
            error: 'identity_provider_unavailable',
        });

        onFailed.mockClear();
        continuation.onTerminal?.('failed', failedArtifact({ actionId: 'teams.identity.connections.disable' }));
        expect(onFailed).toHaveBeenCalledWith('approval_binding_mismatch');
    });
});

describe('createActionApprovalContinuation', () => {
    it('delivers strict deferred Board failure details through the canonical failure envelope', () => {
        const boardActionId = 'session.board.layout.update' as const;
        const boardInput = {
            sessionId: 'session-1',
            expectedLayoutRevision: null,
            operation: { op: 'tab.create' as const, tabId: 'overview', title: 'Overview' },
        };
        const onFailed = vi.fn();
        const continuation = createActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId: boardActionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            expectedInput: boardInput,
            onSucceeded: vi.fn(),
            onFailed,
        });

        continuation.onTerminal?.('failed', failedArtifact({
            actionId: boardActionId,
            actionArgs: boardInput,
            errorCode: 'session_board_revision_conflict',
            details: { currentLayoutRevision: 'ssr1.AAAACHN5c3JlY18xAAAAAQ' },
        }));

        expect(onFailed).toHaveBeenCalledWith(
            'session_board_revision_conflict',
            {
                ok: false,
                errorCode: 'session_board_revision_conflict',
                error: 'session_board_revision_conflict',
                details: { currentLayoutRevision: 'ssr1.AAAACHN5c3JlY18xAAAAAQ' },
            },
        );
    });

    it('settles an exact non-Home-domain Action through its canonical Action output schema', async () => {
        const boardActionId = 'session.board.layout.update' as const;
        const boardInput = {
            sessionId: 'session-1',
            expectedLayoutRevision: null,
            operation: { op: 'tab.create' as const, tabId: 'overview', title: 'Overview' },
        };
        const boardResult = {
            v: 1 as const,
            serverId: 'home-1',
            sessionId: 'session-1',
            result: {
                operation: 'update_layout' as const,
                outcome: 'created' as const,
                layoutRevision: 'ssr1.AAAACHN5c3JlY18xAAAAAQ',
            },
            destination: null,
        };
        const onSucceeded = vi.fn();
        const onFailed = vi.fn();
        const continuation = createActionApprovalContinuation({
            artifactId: 'approval-1',
            actionId: boardActionId,
            scope: { serverId: 'home-1', accountId: 'account-1' },
            expectedInput: boardInput,
            onSucceeded,
            onFailed,
        });

        expect(await continuation.onExecuted(executedArtifact({
            actionId: boardActionId,
            actionArgs: boardInput,
            result: boardResult,
        }))).toBe('consumed');
        expect(onSucceeded).toHaveBeenCalledWith(boardResult);
        expect(onFailed).not.toHaveBeenCalled();
    });
});
