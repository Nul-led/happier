import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemTaskResult, SystemTaskSpec } from '@happier-dev/protocol';
import { act } from 'react-test-renderer';

import { flushHookEffects, renderHook, standardCleanup } from '@/dev/testkit';

const approvalMocks = vi.hoisted(() => ({
    readCredentials: vi.fn(),
    serverFetch: vi.fn(),
    createServerFetchAtEndpoint: vi.fn(),
    endpointFetch: vi.fn(),
}));

vi.mock('@/auth/storage/tokenStorage', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    TokenStorage: {
        getCredentialsForServerUrl: (...args: unknown[]) => approvalMocks.readCredentials(...args),
    },
}));

vi.mock('@/sync/http/client', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    serverFetch: (...args: unknown[]) => approvalMocks.serverFetch(...args),
    createServerFetchAtEndpoint: (...args: unknown[]) => approvalMocks.createServerFetchAtEndpoint(...args),
}));

import { buildLocalMachineSetupSystemTaskSpec } from './buildLocalMachineSetupSystemTaskSpec';
import { createSystemTaskRunner } from './createSystemTaskRunner';
import { useThisComputerSetupTask } from './useThisComputerSetupTask';
import type { SystemTaskBridgeListenerSet } from './types';

function createManualRunner() {
    let nextTaskId = 1;
    let nextTsMs = 1;
    const listeners = new Map<string, SystemTaskBridgeListenerSet>();
    const bridge = {
        capabilities: {},
        start: vi.fn(async (_spec: SystemTaskSpec) => `personal-home-task-${nextTaskId++}`),
        subscribe: vi.fn(async (taskId: string, taskListeners: SystemTaskBridgeListenerSet) => {
            listeners.set(taskId, taskListeners);
            return () => {
                listeners.delete(taskId);
            };
        }),
        cancel: vi.fn(async () => undefined),
        respond: vi.fn(async () => undefined),
    };

    return {
        runner: createSystemTaskRunner({ bridge }),
        bridge,
        emitResult(taskId: string, result: SystemTaskResult) {
            listeners.get(taskId)?.onResult(result);
        },
        emitEvent(taskId: string, event: Record<string, unknown>) {
            listeners.get(taskId)?.onEvent({
                protocolVersion: 1,
                taskId,
                tsMs: nextTsMs++,
                ...event,
            });
        },
    };
}

describe('useThisComputerSetupTask Personal Home composition', () => {
    afterEach(() => {
        standardCleanup();
    });

    it('starts the existing local-machine recipe from the supplied Home descriptor without changing it', async () => {
        const manual = createManualRunner();
        const spec = buildLocalMachineSetupSystemTaskSpec({
            activeRelayUrl: 'http://127.0.0.1:43123',
            activeWebappUrl: 'http://127.0.0.1:43123',
            activeLocalRelayUrl: 'http://127.0.0.1:43123',
            installService: true,
            startService: true,
            verifyService: true,
        });
        const hook = await renderHook(() => useThisComputerSetupTask({ runner: manual.runner }));

        let taskId: string | undefined;
        await act(async () => {
            taskId = await hook.getCurrent().start(spec);
        });

        expect(taskId).toBe('personal-home-task-1');
        expect(manual.bridge.start).toHaveBeenCalledWith(spec);
        expect(manual.bridge.start).toHaveBeenCalledTimes(1);
    });

    it('keeps daemon pairing failure scoped to the task instead of requesting Home auth follow-up', async () => {
        const manual = createManualRunner();
        const onNeedsAuth = vi.fn();
        const onSucceeded = vi.fn();
        const hook = await renderHook(() => useThisComputerSetupTask({
            runner: manual.runner,
            onNeedsAuth,
            onSucceeded,
        }));

        let taskId: string | undefined;
        await act(async () => {
            taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec());
        });
        expect(taskId).toBeTruthy();

        await act(async () => {
            manual.emitResult(taskId!, {
                protocolVersion: 1,
                taskId: taskId!,
                ok: false,
                error: {
                    code: 'daemon_service_not_ready',
                    message: 'Background service is not ready yet.',
                },
            });
        });
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(onNeedsAuth).not.toHaveBeenCalled();
        expect(onSucceeded).not.toHaveBeenCalled();
        expect(hook.getCurrent().activeTaskSnapshot?.result).toEqual(expect.objectContaining({
            ok: false,
            error: expect.objectContaining({ code: 'daemon_service_not_ready' }),
        }));
    });

    describe('blocking token-only pairing approval', () => {
        beforeEach(() => {
            approvalMocks.readCredentials.mockReset();
            approvalMocks.serverFetch.mockReset();
            approvalMocks.endpointFetch.mockReset();
            approvalMocks.createServerFetchAtEndpoint.mockReset();
            approvalMocks.createServerFetchAtEndpoint.mockImplementation(() => approvalMocks.endpointFetch);
        });

        function emitApprovalPrompt(manual: ReturnType<typeof createManualRunner>, taskId: string, relayUrl: string): void {
            manual.emitEvent(taskId, {
                type: 'prompt',
                stepId: 'setup.thisComputer.auth.request',
                message: 'Approve this computer in Happier to continue',
                data: {
                    kind: 'authRequest',
                    publicKey: 'pub-key-b64',
                    response: 'opaque-token-only-response-b64',
                    responseKind: 'tokenOnly',
                    relayUrl,
                    webappUrl: relayUrl,
                },
            });
        }

        it('approves through the explicit endpoint with the Home-scoped token and answers without credentials', async () => {
            approvalMocks.readCredentials.mockResolvedValue({ token: 'home-b-bearer' });
            approvalMocks.endpointFetch
                .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'pending', supportsV2: true }), { status: 200 }))
                .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

            const manual = createManualRunner();
            const hook = await renderHook(() => useThisComputerSetupTask({
                runner: manual.runner,
                authRequestApproval: {
                    expectedRelayUrl: 'http://127.0.0.1:3005',
                    serverId: 'srv_home_b',
                },
            }));

            let taskId: string | undefined;
            await act(async () => {
                taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec());
            });
            emitApprovalPrompt(manual, taskId!, 'http://127.0.0.1:3005');
            await flushHookEffects({ cycles: 3, turns: 2 });

            // The Home-scoped credential is read for the prompt's explicit target only.
            expect(approvalMocks.readCredentials).toHaveBeenCalledWith(
                'http://127.0.0.1:3005',
                { serverId: 'srv_home_b' },
            );
            expect(approvalMocks.serverFetch).not.toHaveBeenCalled();
            const postCall = approvalMocks.endpointFetch.mock.calls.find(
                ([path]) => path === '/v1/auth/response',
            );
            expect(postCall).toBeTruthy();
            const init = postCall![1] as RequestInit;
            expect((init.headers as Record<string, string>).Authorization).toBe('Bearer home-b-bearer');
            expect(JSON.parse(String(init.body))).toEqual({
                publicKey: 'pub-key-b64',
                response: 'opaque-token-only-response-b64',
                responseKind: 'tokenOnly',
            });

            // The answer itself carries no credential or secret material.
            expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, { approved: true });
        });

        it('declines a token-only approval prompt whose explicit target identity does not match', async () => {
            const manual = createManualRunner();
            const hook = await renderHook(() => useThisComputerSetupTask({
                runner: manual.runner,
                authRequestApproval: {
                    expectedRelayUrl: 'http://127.0.0.1:3005',
                    serverId: 'srv_home_b',
                },
            }));

            let taskId: string | undefined;
            await act(async () => {
                taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec());
            });
            emitApprovalPrompt(manual, taskId!, 'http://127.0.0.9:9999');
            await flushHookEffects({ cycles: 3, turns: 2 });

            expect(approvalMocks.readCredentials).not.toHaveBeenCalled();
            expect(approvalMocks.createServerFetchAtEndpoint).not.toHaveBeenCalled();
            expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, { approved: false });
        });

        it('declines when no Home-scoped credential exists for the explicit target', async () => {
            approvalMocks.readCredentials.mockResolvedValue(null);

            const manual = createManualRunner();
            const hook = await renderHook(() => useThisComputerSetupTask({
                runner: manual.runner,
                authRequestApproval: {
                    expectedRelayUrl: 'http://127.0.0.1:3005',
                    serverId: 'srv_home_b',
                },
            }));

            let taskId: string | undefined;
            await act(async () => {
                taskId = await hook.getCurrent().start(buildLocalMachineSetupSystemTaskSpec());
            });
            emitApprovalPrompt(manual, taskId!, 'http://127.0.0.1:3005');
            await flushHookEffects({ cycles: 3, turns: 2 });

            expect(approvalMocks.readCredentials).toHaveBeenCalledTimes(1);
            expect(approvalMocks.createServerFetchAtEndpoint).not.toHaveBeenCalled();
            expect(manual.bridge.respond).toHaveBeenCalledWith(taskId, { approved: false });
        });
    });
});
