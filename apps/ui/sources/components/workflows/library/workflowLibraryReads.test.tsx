import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, renderScreen } from '@/dev/testkit';

const executeMock = vi.hoisted(() => vi.fn());
const account = vi.hoisted(() => ({ id: 'account-a', generation: 0 }));

// The Action front door is the transport boundary; the definition client and its parser stay real.
vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({
    createFrontDoorActionExecute: () => executeMock,
}));

vi.mock('@/sync/domains/scope/activeServerAccountScope', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/scope/activeServerAccountScope')>()),
    captureActiveServerAccountScopeLifetime: () => {
        const generation = account.generation;
        return {
            scope: { serverId: 'server-a', accountId: account.id },
            isCurrent: () => account.generation === generation,
            onRetire: () => ({ dispose() {} }),
        };
    },
}));

vi.mock('@/sync/domains/state/storage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/state/storage')>()),
    useActiveServerAccountScope: () => ({ serverId: 'server-a', accountId: account.id }),
}));

function definition(definitionId: string) {
    return { kind: 'workflow-definition.v1', definitionId, revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: `Workflow ${definitionId}` } };
}

let probes: Record<string, ReturnType<typeof import('./workflowLibraryReads')['useWorkflowDefinitionLibrary']>> = {};

function Probe(props: Readonly<{ name: string; useLibrary: typeof import('./workflowLibraryReads')['useWorkflowDefinitionLibrary'] }>) {
    probes[props.name] = props.useLibrary();
    return null;
}

afterEach(async () => {
    const { resetWorkflowLibraryReadsForTests } = await import('./workflowLibraryReads');
    resetWorkflowLibraryReadsForTests();
    executeMock.mockReset();
    probes = {};
    account.id = 'account-a';
    account.generation = 0;
});

describe('useWorkflowDefinitionLibrary', () => {
    it('serves the column and the library home from one read when they mount together', async () => {
        const { useWorkflowDefinitionLibrary } = await import('./workflowLibraryReads');
        const page = createDeferred<unknown>();
        executeMock.mockReturnValueOnce(page.promise);

        await renderScreen(<>
            <Probe name="column" useLibrary={useWorkflowDefinitionLibrary} />
            <Probe name="home" useLibrary={useWorkflowDefinitionLibrary} />
        </>);
        await act(async () => {
            page.resolve({ ok: true, result: { definitions: [definition('wf-1')] } });
            await page.promise;
        });

        expect(executeMock.mock.calls.filter(([actionId]) => actionId === 'workflow.definition.list')).toHaveLength(1);
        expect(probes.column!.definitions.map((entry) => entry.definitionId)).toEqual(['wf-1']);
        expect(probes.home!.definitions).toBe(probes.column!.definitions);
    });

    it('never shows one Account’s workflows to the next Account while its own list loads', async () => {
        const { useWorkflowDefinitionLibrary } = await import('./workflowLibraryReads');
        executeMock.mockResolvedValueOnce({ ok: true, result: { definitions: [definition('wf-a')] } });
        const screen = await renderScreen(<Probe name="column" useLibrary={useWorkflowDefinitionLibrary} />);
        await act(async () => { await Promise.resolve(); });
        expect(probes.column!.definitions.map((entry) => entry.definitionId)).toEqual(['wf-a']);

        const accountB = createDeferred<unknown>();
        executeMock.mockReturnValueOnce(accountB.promise);
        account.id = 'account-b';
        account.generation += 1;
        await act(async () => { screen.tree.update(<Probe name="column" useLibrary={useWorkflowDefinitionLibrary} />); });

        expect(probes.column!.status).toBe('loading');
        expect(probes.column!.definitions).toEqual([]);

        await act(async () => {
            accountB.resolve({ ok: true, result: { definitions: [definition('wf-b')] } });
            await accountB.promise;
        });
        expect(probes.column!.definitions.map((entry) => entry.definitionId)).toEqual(['wf-b']);
    });
});
