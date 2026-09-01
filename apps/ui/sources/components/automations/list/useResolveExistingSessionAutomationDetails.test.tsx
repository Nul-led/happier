import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, renderHook } from '@/dev/testkit';
import type { AutomationDefinition } from '@/sync/domains/automations/automationTypes';

const refreshAutomationDefinitionDetail = vi.hoisted(() => vi.fn());

vi.mock('@/sync/sync', () => ({
    sync: { refreshAutomationDefinitionDetail },
}));

function unloadedDefinition(id: string): AutomationDefinition {
    return {
        id,
        name: id,
        description: null,
        enabled: true,
        triggers: [],
        lastRunAt: null,
        targetType: 'existingSession',
        templateVersion: 1,
        createdAt: 1,
        updatedAt: 1,
        assignments: [],
        detail: { kind: 'unloaded', templateVersion: 1 },
        existingSessionId: null,
        linkedExistingSessionId: null,
    };
}

describe('useResolveExistingSessionAutomationDetails', () => {
    afterEach(() => {
        refreshAutomationDefinitionDetail.mockReset();
    });

    it('does not duplicate unresolved reads when a sibling store update rerenders the hook', async () => {
        const first = createDeferred<void>();
        const second = createDeferred<void>();
        refreshAutomationDefinitionDetail.mockImplementation((automationId: string) => (
            automationId === 'automation-a' ? first.promise : second.promise
        ));
        const automations = [
            unloadedDefinition('automation-a'),
            unloadedDefinition('automation-b'),
        ];
        const { useResolveExistingSessionAutomationDetails } = await import(
            './useResolveExistingSessionAutomationDetails'
        );
        const hook = await renderHook(
            (props: { automations: AutomationDefinition[] }) => (
                useResolveExistingSessionAutomationDetails({
                    automations: props.automations,
                    accountScopeKey: 'server-a\u0000account-a',
                    enabled: true,
                })
            ),
            { initialProps: { automations } },
        );

        expect(refreshAutomationDefinitionDetail.mock.calls.map((call) => call[0]).sort()).toEqual([
            'automation-a',
            'automation-b',
        ]);
        expect(hook.getCurrent().resolving).toBe(true);

        await hook.rerender({ automations: [...automations] });
        expect(refreshAutomationDefinitionDetail).toHaveBeenCalledTimes(2);

        await act(async () => {
            first.resolve();
            await first.promise;
        });
        await hook.rerender({
            automations: [
                {
                    ...automations[0]!,
                    linkedExistingSessionId: 'session-a',
                    detail: { kind: 'loaded' },
                },
                automations[1]!,
            ],
        });
        expect(refreshAutomationDefinitionDetail).toHaveBeenCalledTimes(2);
        expect(hook.getCurrent().resolving).toBe(true);

        await act(async () => {
            second.reject(new Error('offline'));
            await Promise.allSettled([second.promise]);
        });
        expect(hook.getCurrent().hasFailure).toBe(true);
        expect(hook.getCurrent().resolving).toBe(false);
        await hook.unmount();
    });
});
