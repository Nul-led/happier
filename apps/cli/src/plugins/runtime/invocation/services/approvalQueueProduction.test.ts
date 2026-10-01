import { describe, expect, it, vi } from 'vitest';

import { normalizeActionsSettingsV1 } from '@happier-dev/protocol';

import type { RuntimeActionSettingsProvider } from '@/settings/actionsSettingsProvider';
import { createPluginRuntimeOccurrenceId } from '@/plugins/runtime/runtimeSlots';

import { createPluginActionCallerMaterializationFixture } from './actionCaller.testkit';
import { createProductionPluginApprovalQueueOwner } from './approvalQueueProduction';

const executorBoundary = vi.hoisted(() => ({
    create: vi.fn(() => ({
        execute: vi.fn(async () => ({ ok: true, result: { items: [] } })),
    })),
}));

vi.mock('@/session/actions/createCliActionExecutorFromCredentials', () => ({
    createCliActionExecutorFromCredentials: executorBoundary.create,
}));

describe('production plugin approval queue principal binding', () => {
    it('constructs approval execution with the exact reviewed scoped Action policy', async () => {
        const credentials = { token: 'scoped-token', encryption: null } as const;
        const actionsSettingsProvider: RuntimeActionSettingsProvider = {
            getActionsSettings: () => normalizeActionsSettingsV1({
                v: 1,
                actions: { 'teams.archive': { enabled: false } },
            }),
        };
        const materialization = createPluginActionCallerMaterializationFixture('acme.plugin');
        const queue = createProductionPluginApprovalQueueOwner({
            readCredentials: async () => credentials,
            actionsSettingsProvider,
        }).bind({
            plugin: { id: 'acme.plugin', version: '1.0.0' },
            contribution: { id: 'action', qualifiedId: 'acme.plugin/actions/action' },
            resolveCurrentPluginMaterializationRef:
                materialization.resolveCurrentPluginMaterializationRef,
            occurrenceId: createPluginRuntimeOccurrenceId('acme.plugin'),
            sourceCustody: { kind: 'development', registeredRootId: 'plugin-root' },
            correlationId: 'correlation-1',
            surface: 'agent',
            signal: new AbortController().signal,
            isOccurrenceCurrent: () => true,
        });

        await expect(queue.list()).resolves.toEqual({ items: [] });
        expect(executorBoundary.create).toHaveBeenCalledOnce();
        expect(executorBoundary.create).toHaveBeenCalledWith({
            credentials,
            actionsSettingsProvider,
        });
    });
});
