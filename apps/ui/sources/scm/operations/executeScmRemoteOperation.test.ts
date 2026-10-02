import { SCM_OPERATION_ERROR_CODES, type ScmRemotePolicy, type ScmRemoteResponse } from '@happier-dev/protocol/scm';
import { describe, expect, it, vi } from 'vitest';

const { alert, confirm } = vi.hoisted(() => ({ alert: vi.fn(), confirm: vi.fn(async () => true) }));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert, confirm } }).module;
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

const { executeScmRemoteOperation } = await import('./executeScmRemoteOperation');

function run(failureFeedback: 'alert' | 'outcomeLine', behavior?: Readonly<{ execute?: () => Promise<ScmRemoteResponse>; refresh?: () => Promise<void>; policy?: ScmRemotePolicy; leaseSupported?: boolean; pushRejectPolicy?: 'prompt_fetch' | 'auto_fetch' }>) {
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
            branch: { head: 'v0.3', upstream: 'origin/v0.3', upstreamOid: 'a'.repeat(40), ahead: 3, behind: 2, detached: false },
            capabilities: { writeRemotePush: true, writeRemoteFetch: true, writeRemoteForceWithLease: behavior?.leaseSupported ?? true },
            totals: { includedFiles: 0, pendingFiles: 0, untrackedFiles: 0 },
            entries: [],
        } as never,
        scmWriteEnabled: true,
        scmCommitStrategy: 'atomic',
        scmRemoteConfirmPolicy: 'never',
        scmPushRejectPolicy: behavior?.pushRejectPolicy ?? 'prompt_fetch',
        surface: 'update',
        setScmOperationBusy: vi.fn(),
        setScmOperationStatus: vi.fn(),
        runWithOperationLock: async (_kind, body) => { await body(); return { started: true }; },
        executeRemoteOperation: behavior?.execute ?? executeRemoteOperation,
        reportOperation,
        refreshAfterSuccess: behavior?.refresh ?? vi.fn(async () => {}),
        failureFeedback,
        policy: behavior?.policy,
    });
    return { done, reportOperation };
}

describe('executeScmRemoteOperation failure feedback', () => {
    it('always asks before rewriting an observed remote even when ordinary push confirmation is disabled', async () => {
        confirm.mockClear().mockResolvedValue(false);
        const execute = vi.fn(async () => ({ success: true }));
        await run('outcomeLine', { execute, policy: { pushMode: 'force_with_lease', expectedRemoteOid: 'a'.repeat(40) } }).done;
        expect(confirm).toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects an unadvertised lease without dispatching an ordinary push', async () => {
        const execute = vi.fn(async () => ({ success: true }));
        const { done, reportOperation } = run('outcomeLine', { execute, leaseSupported: false, policy: { pushMode: 'force_with_lease', expectedRemoteOid: 'a'.repeat(40) } });
        await done;
        expect(execute).not.toHaveBeenCalled();
        expect(reportOperation).toHaveBeenCalledWith(expect.objectContaining({ outcome: expect.objectContaining({ kind: 'failed', errorCode: 'FEATURE_UNSUPPORTED' }) }));
    });

    it('keeps the typed stale-lease refusal for explicit recovery without automatic fetch or replay', async () => {
        confirm.mockClear().mockResolvedValue(true);
        const execute = vi.fn(async () => ({ success: false as const, errorCode: SCM_OPERATION_ERROR_CODES.REMOTE_NON_FAST_FORWARD }));
        const { done, reportOperation } = run('outcomeLine', { execute, pushRejectPolicy: 'auto_fetch', policy: { pushMode: 'force_with_lease', expectedRemoteOid: 'a'.repeat(40) } });
        await done;
        expect(execute).toHaveBeenCalledTimes(1);
        expect(reportOperation).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: expect.objectContaining({ kind: 'needs_input', errorCode: 'REMOTE_NON_FAST_FORWARD' }) }));
    });

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
