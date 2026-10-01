import * as React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { getStorage } from '@/sync/domains/state/storageStore';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createWorkflowDefinitionFixture, createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { buildWorkflowReviewedRunSeed, storeWorkflowReviewedRunSeed } from '@/sync/domains/workflows/workflowReviewedRunSeed';
import { WorkflowEditorHostScreen } from './WorkflowEditorHostScreen';
import { captureActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({ createFrontDoorActionExecute: () => transport }));
vi.mock('@/sync/runtime/orchestration/connectionManager', () => ({
    getAppliedActiveServerSnapshot: () => ({ serverId: 'server-a' }),
    isAppliedActiveServerRuntimeAvailable: () => true,
}));
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }), useNavigation: () => ({}) }));
vi.mock('expo-crypto', async () => ({ randomUUID: (await import('node:crypto')).randomUUID }));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

describe('editor workflow composer', () => {
    beforeEach(() => {
        const machine = createMachineFixture();
        getStorage().setState({ profileScope: { serverId: 'server-a', accountId: 'account-a' },
            machines: { [machine.id]: machine }, machineListByServerId: {} });
        transport.mockReset();
        transport.mockImplementation(async (action: string) => action === 'workflow.trigger.list'
            ? { ok: true, result: { sets: [] } } : { ok: false, errorCode: 'unsupported_action', error: 'unsupported_action' });
    });

    it('reviews a no-input draft before admitting it, without saving', async () => {
        expect(captureActiveServerAccountScopeLifetime()?.isCurrent()).toBe(true);
        const seedId = storeWorkflowReviewedRunSeed(buildWorkflowReviewedRunSeed({
            run: createWorkflowRunSummaryFixture(), definition: createWorkflowDefinitionFixture({ inputs: [], blocks: [{
                kind: 'wait', id: 'review', document: { text: 'Check status', references: [], attachments: [] },
            }] }),
            acceptedContext: { source: { kind: 'inline' }, inputs: {}, machineId: 'machine-1',
                executionTarget: { kind: 'session' }, origin: { kind: 'direct' }, metadata: { title: 'Reviewed draft' },
                workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo' } } },
        }));
        const screen = await renderScreen(<AppPaneProvider><WorkflowEditorHostScreen source={{ kind: 'new', reviewedRunSeedId: seedId }} /></AppPaneProvider>);
        await screen.pressByTestIdAsync('workflow-editor-run-now');
        expect(transport.mock.calls.filter(([action]) => action === 'workflow.run.start')).toHaveLength(0);
        expect(screen.findByTestId('workflow-run-inputs-preview')).not.toBeNull();
        expect(transport.mock.calls.filter(([action]) => action === 'workflow.definition.create' || action === 'workflow.definition.update')).toHaveLength(0);
    });
});
