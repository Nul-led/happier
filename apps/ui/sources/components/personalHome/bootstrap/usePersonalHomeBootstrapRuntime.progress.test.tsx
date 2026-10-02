import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import type { SystemTaskBridgeListenerSet, SystemTaskSpec } from '@/components/systemTasks/types';

// Native process boundary: results are held until the test releases them, while the real
// runner, subscriptions, daemon/relay hooks, runtime, controller and setup surface run.
const bridge = vi.hoisted(() => {
    const specs: Array<SystemTaskSpec & { taskId: string }> = [];
    const listeners = new Map<string, SystemTaskBridgeListenerSet>();
    return {
        specs,
        listeners,
        start: async (spec: SystemTaskSpec) => {
            const taskId = `progress-task-${specs.length + 1}`;
            specs.push({ ...spec, taskId });
            return taskId;
        },
        subscribe: async (taskId: string, listener: SystemTaskBridgeListenerSet) => {
            listeners.set(taskId, listener);
            return () => { listeners.delete(taskId); };
        },
        cancel: async () => {},
        respond: async () => {},
    };
});

vi.mock('@/components/systemTasks/createSystemTaskBridge', () => ({
    createSystemTaskBridge: () => bridge,
}));

afterEach(standardCleanup);

describe('Personal Home bootstrap live task progress', () => {
    it('shows daemon CLI acquisition while the first facts read is pending without restarting that read per event', async () => {
        const { usePersonalHomeBootstrapRuntime } = await import('./usePersonalHomeBootstrapRuntime');
        const { PersonalHomeBootstrapContent, PersonalHomeBootstrapGate } = await import('./PersonalHomeBootstrapGate');
        let latestRuntime!: ReturnType<typeof usePersonalHomeBootstrapRuntime>;
        let initialReadFacts!: ReturnType<typeof usePersonalHomeBootstrapRuntime>['readFacts'];
        const readFacts = vi.fn(() => initialReadFacts());
        // Keep the original callback while proving live task delivery independently of facts.
        // The identity assertion below also protects the production mount's effect dependency.
        function Gate() {
            const runtime = usePersonalHomeBootstrapRuntime();
            latestRuntime = runtime;
            initialReadFacts ??= runtime.readFacts;
            return <PersonalHomeBootstrapGate
                isDesktopHost isDesktopMainWindow readFacts={readFacts}
                activeTask={runtime.activeTask}
            ><PersonalHomeBootstrapContent><></></PersonalHomeBootstrapContent></PersonalHomeBootstrapGate>;
        }
        const screen = await renderScreen(<Gate />);

        await act(async () => {
            for (const spec of [...bridge.specs]) {
                if (spec.kind !== 'relay.runtime.status.v1') continue;
                bridge.listeners.get(spec.taskId)?.onResult({
                    protocolVersion: 1, taskId: spec.taskId, ok: true,
                    data: {
                        installed: false, dataPresent: false, relayUrl: 'http://127.0.0.1:3005',
                        service: { active: false, enabled: false },
                    },
                });
            }
        });
        await flushHookEffects();
        const daemonSpec = bridge.specs.filter((spec) => spec.kind === 'daemon.service.status.v1').at(-1)!;
        expect(daemonSpec).toBeDefined();
        const startsBeforeProgress = bridge.specs.length;
        const emit = async (receivedBytes: number) => {
            await act(async () => {
                for (const spec of bridge.specs.filter((entry) => entry.kind === 'daemon.service.status.v1')) {
                    bridge.listeners.get(spec.taskId)?.onEvent({
                        protocolVersion: 1, taskId: spec.taskId, tsMs: receivedBytes,
                        type: 'cli.acquisition.progress', stepId: 'ensureCli',
                        data: { phase: 'downloading', receivedBytes, totalBytes: 4096 },
                    });
                }
            });
        };
        await emit(1024);
        expect(screen.findByTestId('personal-home-bootstrap-download-progress')).not.toBeNull();
        const firstProgress = screen.findByTestId('personal-home-bootstrap-download-progress')!.props.children;
        await emit(2048);
        expect(screen.findByTestId('personal-home-bootstrap-download-progress')!.props.children).not.toEqual(firstProgress);
        expect(latestRuntime.readFacts).toBe(initialReadFacts);
        expect(readFacts).toHaveBeenCalledTimes(1);
        expect(bridge.specs).toHaveLength(startsBeforeProgress);

        await act(async () => {
            for (const spec of bridge.specs.filter((entry) => entry.kind === 'daemon.service.status.v1')) {
                bridge.listeners.get(spec.taskId)?.onResult({
                    protocolVersion: 1, taskId: spec.taskId, ok: true,
                    data: { serviceInstalled: false, daemonRunning: false, needsAuth: false, machineId: null },
                });
            }
        });
        await flushHookEffects();
        expect(screen.findByTestId('personal-home-bootstrap-download-progress')).toBeNull();
    });
});
