import { describe, expect, it, vi } from 'vitest';

import type { NativeSshModule } from '@happier-dev/ssh-native';

describe('createNativeRemoteSshCommandRunner', () => {
    it('requests native host-key prompting by default', async () => {
        const loaded = await import('./nativeCommandRunner').catch(() => null);
        expect(loaded).not.toBeNull();

        const nativeModule = {
            getAvailability: () => ({
                available: true,
                platform: 'android',
                engine: 'russh',
                moduleVersion: '0.0.0',
                supportsLoopbackTunnel: true,
                supportsPersistentHostKeyStorage: false,
            } as const),
            exec: vi.fn(async () => ({
                exitCode: 0,
                stdout: JSON.stringify({ ok: true, data: {} }),
                stderr: '',
            })),
            cancelRequest: vi.fn(async () => undefined),
        } satisfies NativeSshModule;

        await loaded!.createNativeRemoteSshCommandRunner().runJsonCommand({
            command: 'happier auth status --json',
            credentials: {
                host: '10.0.0.5',
                port: 22,
                username: 'dev',
                auth: {
                    username: 'dev',
                    password: 'secret',
                },
            },
            nativeModule,
        });

        expect(nativeModule.exec).toHaveBeenCalledWith(expect.objectContaining({
            requestId: expect.stringMatching(/^native-ssh-command:exec-/u),
            hostKeyVerification: {
                decision: 'prompt',
            },
        }));
    });

    it('cancels native exec requests when the signal aborts', async () => {
        const loaded = await import('./nativeCommandRunner').catch(() => null);
        expect(loaded).not.toBeNull();

        let resolveExec: () => void = () => {
            throw new Error('exec promise was not initialized');
        };
        const nativeModule = {
            getAvailability: () => ({
                available: true,
                platform: 'android',
                engine: 'russh',
                moduleVersion: '0.0.0',
                supportsLoopbackTunnel: true,
                supportsPersistentHostKeyStorage: false,
            } as const),
            exec: vi.fn(async () => {
                await new Promise<void>((resolve) => {
                    resolveExec = resolve;
                });
                return {
                    exitCode: 0,
                    stdout: JSON.stringify({ ok: true, data: {} }),
                    stderr: '',
                };
            }),
            cancelRequest: vi.fn(async () => undefined),
        } satisfies NativeSshModule;
        const abortController = new AbortController();

        const run = loaded!.createNativeRemoteSshCommandRunner().runJsonCommand({
            command: 'happier auth status --json',
            credentials: {
                host: '10.0.0.5',
                port: 22,
                username: 'dev',
                auth: {
                    username: 'dev',
                    password: 'secret',
                },
            },
            nativeModule,
            signal: abortController.signal,
            requestIdPrefix: 'task-a',
        });

        await vi.waitFor(() => {
            expect(nativeModule.exec).toHaveBeenCalled();
        });
        abortController.abort();
        resolveExec();
        await expect(run).rejects.toThrow('native_ssh_task_cancelled');

        expect(nativeModule.exec).toHaveBeenCalledWith(expect.objectContaining({
            requestId: expect.stringMatching(/^task-a:exec-/u),
        }));
        expect(nativeModule.cancelRequest).toHaveBeenCalledWith(expect.stringMatching(/^task-a:exec-/u));
    });

    it('returns structured JSON from non-zero auth probes so pairing can continue', async () => {
        const loaded = await import('./nativeCommandRunner').catch(() => null);
        expect(loaded).not.toBeNull();

        const nativeModule = {
            getAvailability: () => ({
                available: true,
                platform: 'android',
                engine: 'russh',
                moduleVersion: '0.0.0',
                supportsLoopbackTunnel: true,
                supportsPersistentHostKeyStorage: false,
            } as const),
            exec: vi.fn(async () => ({
                exitCode: 1,
                stdout: JSON.stringify({ ok: false, data: { code: 'not_authenticated' } }),
                stderr: '',
            })),
            cancelRequest: vi.fn(async () => undefined),
        } satisfies NativeSshModule;

        await expect(loaded!.createNativeRemoteSshCommandRunner().runJsonCommand({
            command: 'happier auth status --json',
            credentials: {
                host: '10.0.0.5',
                port: 22,
                username: 'dev',
                auth: {
                    username: 'dev',
                    password: 'secret',
                },
            },
            nativeModule,
        })).resolves.toEqual({
            ok: false,
            data: { code: 'not_authenticated' },
        });
    });

    it('forwards bounded stdin and only correlated incremental stdout to the caller', async () => {
        const loaded = await import('./nativeCommandRunner');
        const listeners = new Set<(event: { requestId: string; chunk: string }) => void>();
        const nativeModule = {
            getAvailability: () => ({
                available: true,
                platform: 'android',
                engine: 'russh',
                moduleVersion: '0.0.0',
                supportsLoopbackTunnel: true,
                supportsPersistentHostKeyStorage: false,
            } as const),
            exec: vi.fn(async (request) => {
                for (const listener of listeners) {
                    Reflect.apply(listener, undefined, [{ requestId: request.requestId }]);
                    Reflect.apply(listener, undefined, [{ requestId: request.requestId, chunk: '' }]);
                    listener({ requestId: 'another-request', chunk: 'ignore\n' });
                    listener({ requestId: request.requestId, chunk: 'pairing\n' });
                }
                return { exitCode: 0, stdout: 'pairing\nresult\n', stderr: '' };
            }),
            cancelRequest: vi.fn(async () => undefined),
            addListener: vi.fn((eventName, listener) => {
                expect(eventName).toBe('stdout');
                listeners.add(listener as (event: { requestId: string; chunk: string }) => void);
                return { remove: () => listeners.delete(listener as (event: { requestId: string; chunk: string }) => void) };
            }),
        } satisfies NativeSshModule;
        const onStdoutChunk = vi.fn();

        await loaded.createNativeRemoteSshCommandRunner().runTextCommand({
            command: 'happier auth enroll-remote --json-lines --home-target-stdin',
            credentials: {
                host: '10.0.0.5',
                port: 22,
                username: 'dev',
                auth: { username: 'dev', password: 'secret' },
            },
            nativeModule,
            input: '{"kind":"descriptor"}',
            onStdoutChunk,
        });

        expect(nativeModule.exec).toHaveBeenCalledWith(expect.objectContaining({
            input: '{"kind":"descriptor"}',
        }));
        expect(onStdoutChunk).toHaveBeenCalledTimes(1);
        expect(onStdoutChunk).toHaveBeenCalledWith('pairing\n');
        expect(listeners.size).toBe(0);
    });

    it('fails closed when a native module cannot stream enrollment stdout', async () => {
        const loaded = await import('./nativeCommandRunner');
        const nativeModule = {
            getAvailability: () => ({
                available: true,
                platform: 'android',
                engine: 'russh',
                moduleVersion: '0.0.0',
                supportsLoopbackTunnel: true,
                supportsPersistentHostKeyStorage: false,
            } as const),
            exec: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
            cancelRequest: vi.fn(async () => undefined),
        } satisfies NativeSshModule;

        await expect(loaded.createNativeRemoteSshCommandRunner().runTextCommand({
            command: 'happier auth enroll-remote --json-lines --home-target-stdin',
            credentials: {
                host: '10.0.0.5',
                port: 22,
                username: 'dev',
                auth: { username: 'dev', password: 'secret' },
            },
            nativeModule,
            onStdoutChunk: () => undefined,
        })).rejects.toThrow('native_ssh_stdout_stream_unavailable');
        expect(nativeModule.exec).not.toHaveBeenCalled();
    });
});
