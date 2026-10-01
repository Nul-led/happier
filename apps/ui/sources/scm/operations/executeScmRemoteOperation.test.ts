import { SCM_OPERATION_ERROR_CODES, type ScmRemoteResponse } from '@happier-dev/protocol/scm';
import { describe, expect, it, vi } from 'vitest';

const { alert, confirm } = vi.hoisted(() => ({ alert: vi.fn(), confirm: vi.fn(async () => true) }));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert, confirm } }).module;
});

const { executeScmRemoteOperation } = await import('./executeScmRemoteOperation');

function run(failureFeedback: 'alert' | 'outcomeLine', behavior?: Readonly<{ execute?: () => Promise<ScmRemoteResponse>; refresh?: () => Promise<void> }>) {
    const reportOperation = vi.fn();
    const executeRemoteOperation = vi.fn(async () => ({
        success: false as const,
        errorCode: SCM_OPERATION_ERROR_CODES.REMOTE_NON_FAST_FORWARD,
        error: '! [rejected] v0.3 -> v0.3 (non-fast-forward)',
    }));
    const done = executeScmRemoteOperation({
        kind: 'push',
        repoPath: '/repo',
        scmSnapshot: {
            repo: { isRepo: true, rootPath: '/repo' },
            branch: { head: 'v0.3', upstream: 'origin/v0.3', ahead: 3, behind: 2, detached: false },
            capabilities: { writeRemotePush: true, writeRemoteFetch: true },
            totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0 },
            entries: [],
        } as never,
        scmWriteEnabled: true,
        scmCommitStrategy: 'atomic',
        scmRemoteConfirmPolicy: 'never',
        scmPushRejectPolicy: 'prompt_fetch',
        surface: 'update',
        setScmOperationBusy: vi.fn(),
        setScmOperationStatus: vi.fn(),
        runWithOperationLock: async (_kind, body) => { await body(); return { started: true }; },
        executeRemoteOperation: behavior?.execute ?? executeRemoteOperation,
        reportOperation,
        refreshAfterSuccess: behavior?.refresh ?? vi.fn(async () => {}),
        failureFeedback,
    });
    return { done, reportOperation };
}

describe('executeScmRemoteOperation failure feedback', () => {
    it('leaves a rejected push to the outcome line: logged, no modal and no fetch prompt', async () => {
        alert.mockClear();
        confirm.mockClear();
        const { done, reportOperation } = run('outcomeLine');
        await done;
        expect(reportOperation).toHaveBeenCalledWith(expect.objectContaining({
            operation: 'push', status: 'failed', errorCode: SCM_OPERATION_ERROR_CODES.REMOTE_NON_FAST_FORWARD,
            outcome: expect.objectContaining({ kind: 'needs_input', errorCode: SCM_OPERATION_ERROR_CODES.REMOTE_NON_FAST_FORWARD }),
        }));
        expect(alert).not.toHaveBeenCalled();
        expect(confirm).not.toHaveBeenCalled();
    });

    it('keeps the alert and the fetch prompt for surfaces without an outcome line', async () => {
        alert.mockClear();
        confirm.mockClear().mockResolvedValue(false);
        await run('alert').done;
        expect(alert).toHaveBeenCalled();
        expect(confirm).toHaveBeenCalled();
    });

    it('logs an unknown result when the transport loses a push response', async () => {
        const { done, reportOperation } = run('outcomeLine', { execute: async () => { throw new Error('socket closed'); } });
        await done;
        expect(reportOperation).toHaveBeenCalledWith(expect.objectContaining({ outcome: { v: 1, kind: 'outcome_unknown', errorCode: 'COMMAND_OUTCOME_UNKNOWN', reconciliation: { kind: 'remote_ref', remote: 'origin', branch: 'v0.3' }, nextActions: [{ kind: 'refresh' }] } }));
    });

    it('reports the applied remote effect when a following refresh fails', async () => {
        const { done, reportOperation } = run('outcomeLine', { execute: async () => ({ success: true }), refresh: async () => { throw new Error('status unavailable'); } });
        await done;
        expect(reportOperation).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: { v: 1, kind: 'effect_applied_with_warning', errorCode: 'REPOSITORY_REFRESH_FAILED', effect: { kind: 'remote', remote: 'origin', branch: 'v0.3' }, nextActions: [{ kind: 'refresh' }] } }));
    });
});
