import { describe, expect, it, vi } from 'vitest';

import type { ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { publishHomeAccountChange } from '@/sync/runtime/orchestration/homeAccountChange';

import { subscribeVisibleWorkflowRunListInvalidation } from './workflowRunListInvalidation';

function buildLifetime(params: Readonly<{
    serverId?: string;
    current?: boolean;
}> = {}): ActiveServerAccountScopeLifetime {
    return {
        scope: {
            serverId: params.serverId ?? 'server-a',
            accountId: 'account-a',
        },
        isCurrent: () => params.current ?? true,
        onRetire: () => ({ dispose() {} }),
    };
}

describe('subscribeVisibleWorkflowRunListInvalidation', () => {
    it('refreshes demanded Run detail on a scoped wake without relying on a parent revision', () => {
        const invalidate = vi.fn();
        let demanded = true;
        const unsubscribe = subscribeVisibleWorkflowRunListInvalidation({
            lifetime: buildLifetime(),
            runId: 'run-a',
            isVisibleWindowLoaded: () => demanded,
            invalidate,
        });

        publishHomeAccountChange('server-a', ['workflow-run:run-b']);
        publishHomeAccountChange('server-b', ['workflow-run:run-a']);
        expect(invalidate).not.toHaveBeenCalled();
        publishHomeAccountChange('server-a', ['workflow-run:run-a']);
        publishHomeAccountChange('server-a');
        expect(invalidate).toHaveBeenCalledTimes(2);
        demanded = false;
        publishHomeAccountChange('server-a', ['workflow-run:run-a']);
        expect(invalidate).toHaveBeenCalledTimes(2);
        unsubscribe();
        publishHomeAccountChange('server-a', ['workflow-run:run-a']);
        expect(invalidate).toHaveBeenCalledTimes(2);
    });

    it('invalidates a loaded visible window for an exact workflow Run change', () => {
        const invalidate = vi.fn();
        const unsubscribe = subscribeVisibleWorkflowRunListInvalidation({
            lifetime: buildLifetime(),
            isVisibleWindowLoaded: () => true,
            invalidate,
        });

        publishHomeAccountChange('server-a', ['workflow-run:run-a']);

        expect(invalidate).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('ignores unrelated, unloaded, and retired Account wakes', () => {
        const invalidate = vi.fn();
        const subscriptions = [
            subscribeVisibleWorkflowRunListInvalidation({
                lifetime: buildLifetime(),
                isVisibleWindowLoaded: () => true,
                invalidate,
            }),
            subscribeVisibleWorkflowRunListInvalidation({
                lifetime: buildLifetime(),
                isVisibleWindowLoaded: () => false,
                invalidate,
            }),
            subscribeVisibleWorkflowRunListInvalidation({
                lifetime: buildLifetime({ current: false }),
                isVisibleWindowLoaded: () => true,
                invalidate,
            }),
        ];

        publishHomeAccountChange('server-a', ['self']);
        publishHomeAccountChange('server-b', ['workflow-run:run-a']);
        publishHomeAccountChange('server-a', ['workflow-run:run-a']);

        expect(invalidate).toHaveBeenCalledTimes(1);
        subscriptions.forEach((unsubscribe) => unsubscribe());
    });

    it('conservatively invalidates a loaded visible window for a content-free wake', () => {
        const invalidate = vi.fn();
        const unsubscribe = subscribeVisibleWorkflowRunListInvalidation({
            lifetime: buildLifetime(),
            isVisibleWindowLoaded: () => true,
            invalidate,
        });

        publishHomeAccountChange('server-a');

        expect(invalidate).toHaveBeenCalledTimes(1);
        unsubscribe();
    });
});
