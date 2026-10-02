import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_WORKFLOW_CATALOG_V1 } from '@happier-dev/protocol';
import { createDeferred, renderHook, renderScreen, standardCleanup } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { primeServerFeaturesSnapshot, resetServerFeaturesClientForTests } from '@/sync/api/capabilities/serverFeaturesClient';
import { storage } from '@/sync/domains/state/storageStore';
import { Modal } from '@/modal';
import { WorkflowsLibraryHome } from '../library/WorkflowsLibraryHome';
import { SavedWorkflowRoute } from '@/app/(app)/workflows/[id]/index';
import { useSessionBuiltinWorkflowStart } from '@/components/sessions/agents/launch/useSessionBuiltinWorkflowStart';
import { SessionAgentsLaunchMenu } from '@/components/sessions/agents/launch/SessionAgentsLaunchMenu';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { WorkflowStartPicker } from './WorkflowStartPicker';
import { resetWorkflowLibraryReadsForTests } from '../library/workflowLibraryReads';

const execute = vi.hoisted(() => vi.fn());
const routing = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ params: { id: 'plugin:example.recipe/check' }, router: routing }).module;
});
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});
vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({ createFrontDoorActionExecute: () => execute }));
// Applied network identity is a system boundary; the Account lifetime stays real.
vi.mock('@/sync/runtime/orchestration/connectionManager', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/runtime/orchestration/connectionManager')>(),
    getAppliedActiveServerSnapshot: () => snapshot(),
    isAppliedActiveServerRuntimeAvailable: () => true,
}));
vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'ios' });
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

let snapshot: typeof import('@/sync/domains/server/serverRuntime')['getActiveServerSnapshot'];
let previousState = storage.getState();
beforeEach(async () => {
    previousState = storage.getState();
    const runtime = await import('@/sync/domains/server/serverRuntime');
    snapshot = runtime.getActiveServerSnapshot;
    const server = await runtime.upsertAndActivateServer({ serverUrl: 'http://workflow-picker.test', name: 'Workflow Home' });
    storage.setState({ profileScope: { serverId: server.id, accountId: 'workflow-picker-account' } });
    storage.setState({ settings: { ...storage.getState().settings, experiments: true,
        featureToggles: { ...storage.getState().settings.featureToggles, automations: true } } });
    primeServerFeaturesSnapshot({ serverId: server.id, snapshot: { status: 'ready', features: createRootLayoutFeaturesResponse() } });
});
afterEach(async () => {
    standardCleanup();
    resetWorkflowLibraryReadsForTests();
    (await import('@/sync/domains/scope/activeServerAccountScope')).retireActiveServerAccountScopeLifetime();
    execute.mockReset();
    resetServerFeaturesClientForTests();
    routing.push.mockClear();
    routing.replace.mockClear();
    vi.mocked(Modal.show).mockClear();
    storage.setState(previousState);
});

describe('WorkflowStartPicker plugin workflows', () => {
    const plugin = {
        workflow: 'plugin:example.recipe/check', pluginId: 'example.recipe', version: '1.2.3',
        title: 'Check changes', definition: BUILTIN_WORKFLOW_CATALOG_V1[0]!.definition,
    };
    it('shows the plugin library even when no saved definitions or runs exist', async () => {
        execute.mockImplementation(async (actionId: string) => ({ ok: true, result: actionId === 'workflow.definition.list'
            ? { definitions: [], pluginWorkflows: [plugin] } : { runs: [] } }));
        const screen = await renderScreen(<WorkflowsLibraryHome />);
        await act(async () => { await Promise.resolve(); });
        await screen.pressByTestIdAsync(`workflows-home:row:${plugin.workflow}`);
        expect(routing.push).toHaveBeenCalledWith(`/workflows/${encodeURIComponent(plugin.workflow)}`);
        expect(execute.mock.calls.filter(([id]) => id === 'workflow.run.summaries')).toHaveLength(0);
    });

    it('opens the contribution read-only and duplicates through saved workflow creation', async () => {
        const copyId = '00000000-0000-4000-8000-000000000002';
        execute.mockImplementation(async (actionId: string) => ({ ok: true, result: actionId === 'workflow.definition.create'
            ? { definitionId: copyId, revision: { headerVersion: 1, bodyVersion: 1 }, definition: plugin.definition, metadata: { title: plugin.title } }
            : { definitions: [], pluginWorkflows: [plugin] } }));
        const screen = await renderScreen(<SavedWorkflowRoute />);
        await act(async () => { await Promise.resolve(); });
        expect(screen.findAllByTestId('workflow-plugin:read-only').length).toBeGreaterThan(0);
        expect(screen.findAllByTestId('workflow-editor-name').length).toBe(0);
        await screen.pressByTestIdAsync('workflow-plugin:duplicate');
        expect(execute.mock.calls.find(([id]) => id === 'workflow.definition.create')?.[1]).toMatchObject({
            definition: plugin.definition, metadata: { title: plugin.title },
        });
        expect(execute.mock.calls.some(([id]) => id === 'workflow.definition.get' || id === 'workflow.definition.update')).toBe(false);
        expect(routing.push).toHaveBeenCalledWith(`/workflows/${copyId}`);
    });

    it('starts plugin workflows through the session composer with origin and observed version', async () => {
        const session = createSessionFixture({ serverId: storage.getState().profileScope!.serverId });
        const machine = createMachineFixture();
        storage.setState({ sessions: { [session.id]: session }, machines: { [machine.id]: machine } });
        execute.mockImplementation(async (_actionId: string, input: { runId: string }) => ({ ok: true, result: {
            admission: 'created', run: createWorkflowRunSummaryFixture({ id: input.runId }),
        } }));
        const hook = await renderHook(() => useSessionBuiltinWorkflowStart({ sessionId: session.id }));
        await act(async () => {
            hook.getCurrent()(plugin);
        });
        expect(Modal.show).toHaveBeenCalled();
        const config = vi.mocked(Modal.show).mock.calls[0]![0];
        const props = config.props as { onRun(inputs: Record<string, never>): void };
        await act(async () => { props.onRun({}); await Promise.resolve(); });
        expect(execute.mock.calls.find(([id]) => id === 'workflow.run.start')).toEqual([
            'workflow.run.start', expect.objectContaining({ source: { kind: 'catalog', workflow: plugin.workflow, pluginVersion: plugin.version } }),
            expect.objectContaining({ defaultSessionId: session.id, externalActionTarget: expect.objectContaining({ machineId: 'machine-1' }) }),
        ]);
    });
    it('offers the contribution in the Work launch submenu and selects that exact source', async () => {
        execute.mockResolvedValue({ ok: true, result: { definitions: [], pluginWorkflows: [plugin] } });
        const startPluginWorkflow = vi.fn();
        const launcher = {
            unavailableReason: null, intents: [], agentIds: [], providerLaunch: null,
            openConversation: vi.fn(), openRun: vi.fn(), openDetails: vi.fn(), startBuiltinWorkflow: vi.fn(), startPluginWorkflow,
        };
        const screen = await renderScreen(<SessionAgentsLaunchMenu launcher={launcher} testID="plugin-launch" />);
        // Native/DOM portal painting is a live gate; the real menu's public presentation
        // contract can be selected here without replacing its catalog or library logic.
        await act(async () => { screen.findByType(DropdownMenu).props.onOpenChange(true); });
        await act(async () => { await Promise.resolve(); });
        const menu = screen.findByType(DropdownMenu);
        const items: React.ComponentProps<typeof DropdownMenu>['items'] = menu.props.items;
        const pluginItem = items.find((item) => item.id === 'run-workflow')?.submenu?.items.find((item) => item.testID === `session-agents-launch:plugin:${plugin.workflow}`);
        expect(pluginItem).toMatchObject({ title: plugin.title, category: 'workflows.plugins.fromPlugins' });
        await act(async () => { menu.props.onSelect(pluginItem!.id); });
        expect(startPluginWorkflow).toHaveBeenCalledWith(plugin);
    });
    it('does not retain or select a previous Account catalog while the closed menu changes Account', async () => {
        execute.mockResolvedValueOnce({ ok: true, result: { definitions: [{ kind: 'workflow-definition.v1',
            definitionId: '00000000-0000-4000-8000-000000000003', revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Private saved recipe' } }], pluginWorkflows: [plugin] } });
        const startPluginWorkflow = vi.fn();
        const launcher = { unavailableReason: null, intents: [], agentIds: [], providerLaunch: null,
            openConversation: vi.fn(), openRun: vi.fn(), openDetails: vi.fn(), startBuiltinWorkflow: vi.fn(), startPluginWorkflow };
        const screen = await renderScreen(<SessionAgentsLaunchMenu launcher={launcher} />);
        expect(execute).not.toHaveBeenCalled();
        await act(async () => { screen.findByType(DropdownMenu).props.onOpenChange(true); });
        await act(async () => { await Promise.resolve(); });
        await act(async () => { screen.findByType(DropdownMenu).props.onOpenChange(false); });
        const next = createDeferred<unknown>();
        execute.mockReturnValueOnce(next.promise);
        await act(async () => {
            (await import('@/sync/domains/scope/activeServerAccountScope')).retireActiveServerAccountScopeLifetime();
            storage.setState({ profileScope: { serverId: storage.getState().profileScope!.serverId, accountId: 'next-account' } });
        });
        const menu = screen.findByType(DropdownMenu);
        const items: React.ComponentProps<typeof DropdownMenu>['items'] = menu.props.items;
        const workflowItems = items.find((item) => item.id === 'run-workflow')!.submenu!.items;
        expect(workflowItems.some((item) => item.title === plugin.title || item.title === 'Private saved recipe')).toBe(false);
        await act(async () => { menu.props.onSelect(`plugin-workflow:${plugin.workflow}`); });
        expect(startPluginWorkflow).not.toHaveBeenCalled();
        await act(async () => { menu.props.onOpenChange(true); });
        const pendingItems: React.ComponentProps<typeof DropdownMenu>['items'] = screen.findByType(DropdownMenu).props.items;
        expect(pendingItems.find((item) => item.id === 'run-workflow')!.submenu!.items.some((item) => item.title === plugin.title)).toBe(false);
        await act(async () => { next.resolve({ ok: true, result: { definitions: [] } }); await next.promise; });
    });
    it('selects the catalog definition with its qualified identity and observed plugin version', async () => {
        const plugin = {
            workflow: 'plugin:example.recipe/check', pluginId: 'example.recipe', version: '1.2.3',
            title: 'Check changes', definition: BUILTIN_WORKFLOW_CATALOG_V1[0]!.definition,
        };
        execute.mockResolvedValue({ ok: true, result: { definitions: [], pluginWorkflows: [plugin] } });
        const selected = vi.fn();
        const closed = vi.fn();
        const screen = await renderScreen(<WorkflowStartPicker onSelect={selected} onRequestClose={closed} maxHeight={600} />);
        await act(async () => { await Promise.resolve(); });
        await screen.pressByTestIdAsync(`workflow-choice:${plugin.workflow}`);
        expect(selected).toHaveBeenCalledWith(expect.objectContaining({
            id: plugin.workflow, name: plugin.title, definition: plugin.definition,
            source: { kind: 'catalog', workflow: plugin.workflow, pluginVersion: plugin.version },
        }));
        expect(closed).toHaveBeenCalled();
    });
});
