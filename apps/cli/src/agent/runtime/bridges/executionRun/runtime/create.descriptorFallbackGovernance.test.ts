import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    ExecutionRunHostRuntime,
    ExecutionRunHostRuntimeMessageHandler,
} from '@/agent/runtime/bridges/executionRun/executionRunHostRuntime';
import { MissingBoundCliRuntimeCoreError } from '@/agent/runtime/registry/createCliRuntimeCore';

// One runtime, one lifetime: the signal must stay stable across calls so
// subscribers do not accumulate against a fresh controller each read.
const TEST_RUNTIME_LIFETIME_SIGNAL = new AbortController().signal;

const resolveBackendEngineAdapterResolutionMock = vi.fn();
const TEST_SECONDARY_BACKEND_ID = `${'secondary'}.${'backend'}` as never;

vi.mock('@/agent/runtime/registry/engineRegistry', () => ({
    resolveBackendEngineAdapterResolution: (...args: unknown[]) => resolveBackendEngineAdapterResolutionMock(...args),
}));

import { createExecutionRunRuntime } from './create';

function createStubBackend(label: string): ExecutionRunHostRuntime {
    let handler: ExecutionRunHostRuntimeMessageHandler | null = null;
    return {
        async readResumeSupport() {
            return false;
        },
        async provisionRuntime() {
            return { runtimeId: `runtime_${label}` };
        },
        async deliverInput() {
            return { status: 'admitted' as const };
        },
        getRuntimeLifetimeSignal() {
            return TEST_RUNTIME_LIFETIME_SIGNAL;
        },
        async cancel() {},
        subscribeMessages(next) {
            handler = next;
            return () => {
                if (handler === next) handler = null;
            };
        },
        async dispose() {},
    };
}

describe('createExecutionRunBackend (descriptor fallback governance)', () => {
    beforeEach(() => {
        resolveBackendEngineAdapterResolutionMock.mockReset();
    });

    it('fails closed for non-review backends when engine registry resolution is missing (even if a descriptor is present)', async () => {
        const descriptorFactory = vi.fn(() => createStubBackend('descriptor'));
        resolveBackendEngineAdapterResolutionMock.mockResolvedValue(null);

        const backend = createExecutionRunRuntime({
            cwd: '/tmp',
            scope: 'detached',
            backendId: TEST_SECONDARY_BACKEND_ID,
            backendTarget: { kind: 'builtInAgent', agentId: TEST_SECONDARY_BACKEND_ID as never },
            permissionMode: 'read_only',
        });

        await expect(backend.provisionRuntime({ initialPrompt: 'boot' })).rejects.toThrow('Unsupported execution-run backend');
        expect(descriptorFactory).not.toHaveBeenCalled();
    });

    it('fails closed for review engines when runtimeCore is missing instead of using descriptor fallback', async () => {
        const reviewId = 'acme.review.backend';
        const descriptorFactory = vi.fn(() => createStubBackend('review'));
        resolveBackendEngineAdapterResolutionMock.mockResolvedValue({
            backendId: reviewId,
            agentId: 'review-provider',
            source: 'built_in',
            backend: { id: reviewId, agentId: 'review-provider' },
            agent: { id: 'review-provider' },
            engineAdapter: {
                runtimeCore: {
                    createExecutionRunBackend() {
                        throw new MissingBoundCliRuntimeCoreError(reviewId as string, 'execution runs');
                    },
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

        const backend = createExecutionRunRuntime({
            cwd: '/tmp',
            scope: 'detached',
            backendId: reviewId,
            permissionMode: 'read_only',
        });

        await expect(backend.provisionRuntime({ initialPrompt: 'boot' })).rejects.toThrow(/bound host runtimeCore|Unsupported execution-run backend/i);
        expect(descriptorFactory).not.toHaveBeenCalled();
    });
});
