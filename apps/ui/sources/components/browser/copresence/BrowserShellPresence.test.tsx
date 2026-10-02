import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDeferred, flushHookEffects, renderScreen } from '@/dev/testkit';
import { slideTransitionTokens } from '@/components/ui/motion/slideTransitionTokens';
import { dispatchBrowserControlCommand } from '@/sync/domains/browser/control/commands';
import { createBrowserControlState } from '@/sync/domains/browser/control/reducer';
import { useBrowserDaemonControlTransport } from '@/sync/domains/browser/control/useBrowserDaemonControlTransport';
import type { BrowserControlViewState } from '@/sync/domains/browser/control';

import { BrowserShellPresence } from './BrowserShellPresence';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (...args: unknown[]) => rpc(...args),
}));
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

function view(controller: 'agent' | 'human', controlEpoch: number): BrowserControlViewState {
    const opened = dispatchBrowserControlCommand(createBrowserControlState(), {
        kind: 'openView', commandId: 'open', browserSessionId: 'browser_1', viewId: 'view_1',
        target: { kind: 'streamedBrowser', targetId: 'stream_1', streamId: 'stream_1' },
        platform: 'web', currentUrl: 'https://example.test/', focus: true,
    });
    return { ...opened.state.viewsById.view_1!, automationController: {
        browserSessionId: 'browser_1', viewId: 'view_1', controller, controlEpoch,
    } };
}

function Surface({ currentView }: Readonly<{ currentView: BrowserControlViewState }>) {
    const sendDaemonCommand = useBrowserDaemonControlTransport({ machineId: 'machine_1', serverId: 'server_1' });
    return <BrowserShellPresence view={currentView} controlService={null} agent={null}
        sendDaemonCommand={sendDaemonCommand} testID="p" />;
}

describe('BrowserShellPresence daemon takeover', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });
    it.each(['unavailable', 'connection-lost'] as const)('recovers a %s result through the real app binding and transport', async (failure) => {
        rpc.mockReset();
        if (failure === 'unavailable') rpc.mockResolvedValue({ error: 'Method not found', errorCode: 'RPC_METHOD_NOT_FOUND' });
        else rpc.mockRejectedValue(new Error('socket down'));
        const screen = await renderScreen(<Surface currentView={view('agent', 4)} />);
        await screen.pressByTestIdAsync('p-take-control');
        expect(screen.findHostByTestId('p-take-control')).toBeTruthy();
        // The real motion owner briefly retains the outgoing row, hidden/noninteractive, while it leaves.
        await flushHookEffects({ cycles: 1, advanceTimersMs: slideTransitionTokens.routine.timed.durationMs.enter });
        expect(Boolean(screen.findHostByTestId('p-stopping'))).toBe(false);
        expect(screen.findHostByTestId('p-human')).toBeNull();
        expect(screen.getTextContent()).toContain('browserPresence.stopUnconfirmed');

        const lateAnswer = createDeferred<unknown>();
        rpc.mockImplementationOnce(() => lateAnswer.promise);
        await screen.pressByTestIdAsync('p-take-control');
        expect(screen.findHostByTestId('p-stopping')).toBeTruthy();
        await screen.update(<Surface currentView={view('human', 5)} />);
        await act(async () => { lateAnswer.resolve({ protocolVersion: 1, result: { bogus: true } }); });
        await flushHookEffects({ cycles: 1, advanceTimersMs: slideTransitionTokens.routine.timed.durationMs.enter });
        expect(screen.findHostByTestId('p-human')).toBeTruthy();
        expect(screen.findHostByTestId('p-hand-back')).toBeTruthy();
    });
});
