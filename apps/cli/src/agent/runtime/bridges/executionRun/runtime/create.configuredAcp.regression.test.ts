import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    ExecutionRunHostRuntime,
    ExecutionRunHostRuntimeMessageHandler,
} from '@/agent/runtime/bridges/executionRun/executionRunHostRuntime';

const resolveBackendEngineAdapterResolutionMock = vi.fn();

vi.mock('@/agent/runtime/registry/engineRegistry', () => ({
    resolveBackendEngineAdapterResolution: (...args: unknown[]) => resolveBackendEngineAdapterResolutionMock(...args),
}));

// Imported statically on purpose. `create` pulls a very large CLI module graph, and a dynamic
// `await import('./create')` inside the test body charges Vite's on-demand transform plus first
// evaluation of that graph (~20s here) to `testTimeout`, which made this file time out under
// load instead of measuring the behavior under test. A static import moves that cost into the
// collect phase, which no test timeout bounds.
import { createExecutionRunRuntime } from './create';

// One runtime, one lifetime: the signal must stay stable across calls so
// subscribers do not accumulate against a fresh controller each read.
const TEST_RUNTIME_LIFETIME_SIGNAL = new AbortController().signal;

type StubRuntime = Readonly<{
    runtime: ExecutionRunHostRuntime;
    readDisposeCount: () => number;
    readSubscriberCount: () => number;
}>;

function createStubRuntime(): StubRuntime {
    let handler: ExecutionRunHostRuntimeMessageHandler | null = null;
    let disposeCount = 0;

    return {
        runtime: {
            async readResumeSupport() {
                return false;
            },
            async provisionRuntime() {
                return { runtimeId: 'configured-runtime-1' };
            },
            async deliverInput() {
                handler?.({ type: 'model-output', fullText: 'configured ok' });
                return { status: 'admitted' as const };
            },
            getRuntimeLifetimeSignal() {
                return TEST_RUNTIME_LIFETIME_SIGNAL;
            },
            async cancel() {},
            subscribeMessages(next) {
                handler = next;
                return () => {
                    if (handler === next) {
                        handler = null;
                    }
                };
            },
            async dispose() {
                disposeCount += 1;
            },
        },
        readDisposeCount: () => disposeCount,
        readSubscriberCount: () => (handler ? 1 : 0),
    };
}

describe('createExecutionRunRuntime configured ACP registry convergence', () => {
    beforeEach(() => {
        resolveBackendEngineAdapterResolutionMock.mockReset();
    });

    it('routes configured ACP execution runs through the concrete runtimeCore backend id', async () => {
        const stub = createStubRuntime();
        const createExecutionRunBackend = vi.fn(() => stub.runtime);
        resolveBackendEngineAdapterResolutionMock.mockResolvedValue({
            backendId: 'review-bot',
            agentId: 'review-bot',
            source: 'plugin',
            backend: { id: 'review-bot', agentId: 'review-bot' },
            agent: { id: 'review-bot' },
            engineAdapter: {
                runtimeCore: {
                    createExecutionRunBackend,
                },
            },
            executionSurfaces: {
                terminalRuntime: null,
                externalSessions: null,
                attach: null,
                sessionHandoff: null,
            },
            diagnostics: [],
        });

        const configuredRuntime = createExecutionRunRuntime({
            cwd: '/tmp/workspace',
            scope: 'detached',
            // Generic configured-ACP entry id. The run must resolve the CONCRETE configured
            // backend, never this generic id.
            backendId: 'customAcp',
            backendTarget: {
                kind: 'backend',
                backendId: 'review-bot',
                configuredBackendId: 'review-bot',
                sourceKind: 'configured',
            },
            permissionMode: 'read_only',
        });

        const messages: string[] = [];
        const unsubscribe = configuredRuntime.subscribeMessages((message) => {
            if (message.type === 'model-output') messages.push(message.fullText ?? '<missing>');
        });

        // Reaching the stub's sentinel runtime id is the proof that resolution landed on the
        // registry-provided runtime: no built-in/generic ACP constructor can produce it.
        await expect(configuredRuntime.provisionRuntime()).resolves.toEqual({ runtimeId: 'configured-runtime-1' });

        // Exact-backend resolution, and — the anti-fallback half — the generic entry id is never
        // resolved or constructed behind our back.
        expect(resolveBackendEngineAdapterResolutionMock).toHaveBeenCalledTimes(1);
        expect(resolveBackendEngineAdapterResolutionMock).toHaveBeenCalledWith('review-bot', expect.any(Object));
        expect(resolveBackendEngineAdapterResolutionMock).not.toHaveBeenCalledWith('customAcp', expect.anything());
        expect(createExecutionRunBackend).toHaveBeenCalledTimes(1);
        expect(createExecutionRunBackend).toHaveBeenCalledWith(expect.objectContaining({
            cwd: '/tmp/workspace',
            backendId: 'review-bot',
            backendTarget: {
                kind: 'backend',
                backendId: 'review-bot',
                configuredBackendId: 'review-bot',
                sourceKind: 'configured',
            },
            permissionMode: 'read_only',
        }));

        // The resolved runtime is the canonical execution runtime, wired end to end.
        await configuredRuntime.deliverInput('configured-runtime-1', { text: 'hi' });
        expect(messages).toEqual(['configured ok']);
        expect(stub.readSubscriberCount()).toBe(1);

        // Every handle is released: the message subscription is torn down, the resolved backend is
        // disposed exactly once, and the run's lifetime signal is aborted.
        unsubscribe();
        await configuredRuntime.dispose();
        expect(stub.readSubscriberCount()).toBe(0);
        expect(stub.readDisposeCount()).toBe(1);
        expect(configuredRuntime.getRuntimeLifetimeSignal().aborted).toBe(true);
    });
});
