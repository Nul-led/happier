import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';

const artifactReader = vi.hoisted(() => ({
    value: {
        artifact: null as DecryptedArtifact | null,
        isLoading: false,
        error: null as boolean | null,
        invalidArtifact: false,
    },
}));

vi.mock('./useApprovalArtifact', () => ({
    useApprovalArtifact: ({ artifactId }: Readonly<{ artifactId: string | null }>) => (
        artifactReader.value.artifact === null
        || artifactReader.value.artifact.id === artifactId
            ? artifactReader.value
            : { artifact: null, isLoading: false, error: null, invalidArtifact: false }
    ),
}));

afterEach(() => {
    artifactReader.value = { artifact: null, isLoading: false, error: null, invalidArtifact: false };
    standardCleanup();
});

describe('useActionApprovalContinuation', () => {
    it('claims and clears an executed result before delivering it exactly once', async () => {
        const refresh = vi.fn();
        const deliveryObservedClearedCustody = vi.fn();
        let currentApprovalId: () => string | null = () => null;
        const { useActionApprovalContinuation } = await import('./useActionApprovalContinuation');
        const hookResult = await renderHook(({ tick }) => {
            void tick;
            return useActionApprovalContinuation({ scopeKey: 'home-1:account-1', serverId: 'home-1', onExecuted: refresh });
        }, { initialProps: { tick: 0 } });
        currentApprovalId = () => hookResult.getCurrent().approvalId;

        const onExecuted = vi.fn(async () => {
            deliveryObservedClearedCustody(currentApprovalId());
            return 'consumed' as const;
        });
        act(() => hookResult.getCurrent().requestApproval({ artifactId: 'approval-1', onExecuted }));

        artifactReader.value = {
            artifact: {
                id: 'approval-1',
                title: null,
                header: { title: null, approvalStatus: 'executed' },
                body: '{}',
                headerVersion: 1,
                bodyVersion: 1,
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                isDecrypted: true,
            },
            isLoading: false,
            error: null,
            invalidArtifact: false,
        };
        await hookResult.rerender({ tick: 1 });
        await vi.waitFor(() => expect(onExecuted).toHaveBeenCalledTimes(1));

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(deliveryObservedClearedCustody).toHaveBeenCalledWith(null);
        await hookResult.rerender({ tick: 2 });
        expect(onExecuted).toHaveBeenCalledTimes(1);
    });

    it('hands a chained result-bearing Action to the same owner after the first result is claimed', async () => {
        const { useActionApprovalContinuation } = await import('./useActionApprovalContinuation');
        const hook = await renderHook(({ tick }) => {
            void tick;
            return useActionApprovalContinuation({
                scopeKey: 'home-1:account-1',
                serverId: 'home-1',
                onExecuted: vi.fn(),
            });
        }, { initialProps: { tick: 0 } });
        const secondResult = vi.fn(async () => 'consumed' as const);
        const firstResult = vi.fn(async () => {
            hook.getCurrent().requestApproval({
                artifactId: 'approval-2',
                onExecuted: secondResult,
            });
            return 'consumed' as const;
        });

        act(() => hook.getCurrent().requestApproval({
            artifactId: 'approval-1',
            onExecuted: firstResult,
        }));
        artifactReader.value = {
            artifact: {
                id: 'approval-1',
                title: null,
                header: { title: null, approvalStatus: 'executed' },
                body: '{}',
                headerVersion: 1,
                bodyVersion: 1,
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                isDecrypted: true,
            },
            isLoading: false,
            error: null,
            invalidArtifact: false,
        };
        await hook.rerender({ tick: 1 });
        await vi.waitFor(() => expect(firstResult).toHaveBeenCalledOnce());
        expect(hook.getCurrent().approvalId).toBe('approval-2');

        artifactReader.value = {
            artifact: {
                ...artifactReader.value.artifact!,
                id: 'approval-2',
                seq: 2,
                updatedAt: 3,
            },
            isLoading: false,
            error: null,
            invalidArtifact: false,
        };
        await hook.rerender({ tick: 2 });
        await vi.waitFor(() => expect(secondResult).toHaveBeenCalledOnce());
        expect(hook.getCurrent().approvalId).toBeNull();
    });

    it.each(['rejected', 'canceled'] as const)('releases %s custody and restores retry', async (status) => {
        const { useActionApprovalContinuation } = await import('./useActionApprovalContinuation');
        const hook = await renderHook(({ tick }) => {
            void tick;
            return useActionApprovalContinuation({ scopeKey: 'scope-1', serverId: 'home-1', onExecuted: vi.fn() });
        }, { initialProps: { tick: 0 } });
        const onTerminal = vi.fn();
        act(() => hook.getCurrent().requestApproval({ artifactId: 'approval-1', onExecuted: vi.fn(), onTerminal }));

        artifactReader.value = {
            artifact: {
                id: 'approval-1',
                title: null,
                header: { title: null, approvalStatus: status },
                body: '{}',
                headerVersion: 1,
                bodyVersion: 1,
                seq: 1,
                createdAt: 1,
                updatedAt: 2,
                isDecrypted: true,
            },
            isLoading: false,
            error: null,
            invalidArtifact: false,
        };
        await hook.rerender({ tick: 1 });

        expect(onTerminal).toHaveBeenCalledWith(status, expect.objectContaining({ id: 'approval-1' }));
        expect(hook.getCurrent().approvalId).toBeNull();
        expect(hook.getCurrent().approvalPending).toBe(false);
    });

    it('waits for the failed Artifact body before settling the typed continuation', async () => {
        const { useActionApprovalContinuation } = await import('./useActionApprovalContinuation');
        const hook = await renderHook(({ tick }) => {
            void tick;
            return useActionApprovalContinuation({ scopeKey: 'scope-1', serverId: 'home-1', onExecuted: vi.fn() });
        }, { initialProps: { tick: 0 } });
        const onTerminal = vi.fn();
        act(() => hook.getCurrent().requestApproval({ artifactId: 'approval-1', onExecuted: vi.fn(), onTerminal }));

        const artifact: DecryptedArtifact = {
            id: 'approval-1',
            title: null,
            header: { title: null, approvalStatus: 'failed' },
            body: null,
            headerVersion: 1,
            bodyVersion: 1,
            seq: 1,
            createdAt: 1,
            updatedAt: 2,
            isDecrypted: true,
        };
        artifactReader.value = { artifact, isLoading: false, error: null, invalidArtifact: false };
        await hook.rerender({ tick: 1 });
        expect(onTerminal).not.toHaveBeenCalled();
        expect(hook.getCurrent().approvalId).toBe('approval-1');

        artifactReader.value = {
            artifact: { ...artifact, body: '{}', isDecrypted: true },
            isLoading: false,
            error: null,
            invalidArtifact: false,
        };
        await hook.rerender({ tick: 2 });
        expect(onTerminal).toHaveBeenCalledWith('failed', expect.objectContaining({ id: 'approval-1' }));
        expect(hook.getCurrent().approvalId).toBeNull();
    });

    it('clears a proven-invalid Artifact while retaining transport failures for retry', async () => {
        const { useActionApprovalContinuation } = await import('./useActionApprovalContinuation');
        const hook = await renderHook(({ tick }) => {
            void tick;
            return useActionApprovalContinuation({ scopeKey: 'scope-1', serverId: 'home-1', onExecuted: vi.fn() });
        }, { initialProps: { tick: 0 } });
        const onTerminal = vi.fn();
        act(() => hook.getCurrent().requestApproval({ artifactId: 'approval-1', onExecuted: vi.fn(), onTerminal }));

        artifactReader.value = { artifact: null, isLoading: false, error: true, invalidArtifact: false };
        await hook.rerender({ tick: 1 });
        expect(hook.getCurrent().approvalId).toBe('approval-1');
        expect(onTerminal).not.toHaveBeenCalled();

        artifactReader.value = { artifact: null, isLoading: false, error: true, invalidArtifact: true };
        await hook.rerender({ tick: 2 });
        expect(hook.getCurrent().approvalId).toBeNull();
        expect(onTerminal).toHaveBeenCalledWith('invalid', null);
    });

    it('discards stale process-local custody when the exact scope changes', async () => {
        const { useActionApprovalContinuation } = await import('./useActionApprovalContinuation');
        const hook = await renderHook(({ scopeKey }) => useActionApprovalContinuation({
            scopeKey,
            serverId: 'home-1',
            onExecuted: vi.fn(),
        }), { initialProps: { scopeKey: 'scope-a' } });

        act(() => hook.getCurrent().requestApproval({ artifactId: 'approval-a', onExecuted: vi.fn() }));
        expect(hook.getCurrent().approvalId).toBe('approval-a');

        await hook.rerender({ scopeKey: 'scope-b' });
        expect(hook.getCurrent().approvalId).toBeNull();
    });
});
