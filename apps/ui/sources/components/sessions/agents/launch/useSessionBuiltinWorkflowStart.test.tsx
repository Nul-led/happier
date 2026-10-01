import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { createWorkflowRunSummaryFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { createMachineFixture } from '@/dev/testkit/fixtures/machineFixtures';
import { storage } from '@/sync/domains/state/storageStore';

const RUN_ID = '00000000-0000-4000-8000-000000000001';

// FIN's run start goes through the Action front door (a transport boundary); its controller, the
// request schema and the input sheet presenter stay real.
const executeMock = vi.hoisted(() => vi.fn());
const modalMock = vi.hoisted(() => ({ show: vi.fn(() => 'modal-1'), update: vi.fn(), hide: vi.fn(), alert: vi.fn(async () => {}) }));
const routerPush = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({
    createFrontDoorActionExecute: () => executeMock,
}));
vi.mock('@/modal', () => ({ Modal: modalMock }));
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});
vi.mock('@/sync/domains/scope/activeServerAccountScope', () => ({
    captureActiveServerAccountScopeLifetime: () => ({
        scope: { serverId: 'server-a', accountId: 'account-a' },
        isCurrent: () => true,
    }),
}));
vi.mock('@/components/appShell/workspace/destinationRoute', () => ({
    useRouter: () => ({ push: routerPush }),
}));
vi.mock('@/platform/randomUUID', () => ({ randomUUID: () => RUN_ID }));

function admitted(originSessionId: string) {
    return {
        ok: true,
        result: { run: createWorkflowRunSummaryFixture({ id: RUN_ID, origin: { kind: 'direct', originSessionId } }), admission: 'created' },
    };
}

type SheetProps = Readonly<{
    inputs: ReadonlyArray<{ name: string }>;
    onRun: (inputs: Record<string, unknown> | undefined) => void;
}>;

describe('useSessionBuiltinWorkflowStart', () => {
    beforeEach(() => {
        const session = createSessionFixture({ serverId: 'server-a', active: true,
            metadata: { path: '/repo', host: 'tester.local', machineId: 'machine-1' } });
        const machine = createMachineFixture({ id: 'machine-1', active: true });
        storage.setState({ workflowRunsById: {}, sessions: { [session.id]: session },
            machines: { [machine.id]: machine }, machineListByServerId: { 'server-a': [machine] } });
    });

    afterEach(() => {
        executeMock.mockReset();
        modalMock.show.mockClear();
        modalMock.update.mockClear();
        modalMock.hide.mockClear();
        routerPush.mockReset();
        standardCleanup();
    });

    it('asks a built-in\'s declared inputs, then starts it through FIN\'s run start on this session\'s machine and folder', async () => {
        executeMock.mockImplementationOnce(async (_actionId: string, _input: unknown, context: { defaultSessionId: string }) => admitted(context.defaultSessionId));
        const { useSessionBuiltinWorkflowStart } = await import('./useSessionBuiltinWorkflowStart');
        const hook = await renderHook(() => useSessionBuiltinWorkflowStart({ sessionId: 'session-1', serverId: 'server-a' }));

        await act(async () => {
            hook.getCurrent()('builtin:open-a-pull-request');
        });

        // Nothing starts before the person fills the declared inputs.
        expect(executeMock).not.toHaveBeenCalled();
        expect(modalMock.show).toHaveBeenCalledTimes(1);
        const sheet = (modalMock.show.mock.calls[0] as unknown as [{ props: SheetProps }])[0].props;
        expect(sheet.inputs.map((input) => input.name)).toEqual(['base', 'title', 'body', 'question']);

        await act(async () => {
            sheet.onRun({ base: 'main', title: 'Retry states' });
        });

        expect(executeMock).toHaveBeenCalledWith('workflow.run.start', expect.objectContaining({
            runId: RUN_ID,
            source: { kind: 'catalog', workflow: 'builtin:open-a-pull-request' },
            inputs: { base: 'main', title: 'Retry states' },
        }), expect.objectContaining({
            // The invoking session is the Run's origin (FIN's one origin producer).
            defaultSessionId: 'session-1',
            externalActionTarget: expect.objectContaining({
                kind: 'machine',
                machineId: 'machine-1',
                project: expect.objectContaining({ directory: '/repo' }),
            }),
        }));
        expect(routerPush).toHaveBeenCalledWith({ pathname: '/workflows/runs/[runId]', params: { runId: RUN_ID } });
        expect(storage.getState().workflowRunsById[RUN_ID]?.summary?.origin).toEqual({ kind: 'direct', originSessionId: 'session-1' });
        expect(modalMock.hide).toHaveBeenCalled();
    });

    it('starts nothing for a built-in that runs inside a session, which this start cannot name yet', async () => {
        const { useSessionBuiltinWorkflowStart } = await import('./useSessionBuiltinWorkflowStart');
        const hook = await renderHook(() => useSessionBuiltinWorkflowStart({ sessionId: 'session-1', serverId: 'server-a' }));

        await act(async () => {
            hook.getCurrent()('builtin:review-and-converge');
        });

        expect(modalMock.show).not.toHaveBeenCalled();
        expect(executeMock).not.toHaveBeenCalled();
    });
});
