import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import type { ExecProcessHandleV1 } from './privateContract';

import { PluginExecClientError } from './errors';
import { createJsonRpcProcessClient } from './jsonRpc';
import { encodeContentLengthFrame } from './contentLengthFraming';

type JsonRpcMessageHookFixture = Readonly<{
    onMessage?: (
        message: unknown,
        context: Readonly<{ phase: 'incoming' | 'outgoing' }>,
    ) => 'pass' | 'suppress' | Readonly<{ kind: 'replace'; message: unknown }>;
}>;

function createInMemoryJsonRpcProcess(params?: Readonly<{
    hooks?: JsonRpcMessageHookFixture;
    maxFrameBytes?: number;
    onFailure?: (error: Error) => void;
}>) {
    const stdout = new PassThrough();
    const writes: string[] = [];
    const process: ExecProcessHandleV1 = {
        pid: 1,
        exit: new Promise(() => undefined),
        async writeStdin(input) {
            writes.push(typeof input === 'string' ? input : Buffer.from(input).toString('utf8'));
        },
        kill: () => undefined,
        dispose: async () => undefined,
    };
    const protocol = createJsonRpcProcessClient({
        process,
        stdout,
        write: process.writeStdin,
        requestTimeoutMs: 25,
        maxFrameBytes: params?.maxFrameBytes,
        onFailure: params?.onFailure,
        ...(params?.hooks ? { hooks: params.hooks } : {}),
    } as Parameters<typeof createJsonRpcProcessClient>[0] & {
        hooks?: JsonRpcMessageHookFixture;
    });
    return { stdout, writes, protocol };
}

describe('A.13p spawned protocol client runtime', () => {
    it('writes JSON-RPC notifications without allocating request ids', async () => {
        const { writes, protocol } = createInMemoryJsonRpcProcess();

        await protocol.client.notify('host/ready', { ok: true });

        expect(writes).toHaveLength(1);
        expect(JSON.parse(writes[0] ?? '')).toEqual({
            jsonrpc: '2.0',
            method: 'host/ready',
            params: { ok: true },
        });
        protocol.dispose();
    });

    it('dispatches child-to-host JSON-RPC notifications without writing responses', async () => {
        const { stdout, writes, protocol } = createInMemoryJsonRpcProcess();
        const received: unknown[] = [];
        protocol.client.registerNotificationHandler('host/status', (params) => {
            received.push(params);
        });

        stdout.write('{"jsonrpc":"2.0","method":"host/status","params":{"ready":true}}\n');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(received).toEqual([{ ready: true }]);
        expect(writes).toEqual([]);
        protocol.dispose();
    });

    it('serializes notifications in transport order without blocking server-request responses', async () => {
        const { stdout, writes, protocol } = createInMemoryJsonRpcProcess();
        const received: number[] = [];
        let releaseFirst!: () => void;
        const firstBlocked = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        protocol.client.registerNotificationHandler('host/status', async (params) => {
            const sequence = (params as { sequence: number }).sequence;
            if (sequence === 1) await firstBlocked;
            received.push(sequence);
        });
        protocol.client.registerRequestHandler('host/question', () => ({ accepted: true }));

        stdout.write([
            '{"jsonrpc":"2.0","method":"host/status","params":{"sequence":1}}',
            '{"jsonrpc":"2.0","method":"host/status","params":{"sequence":2}}',
            '{"jsonrpc":"2.0","id":"request-1","method":"host/question","params":{}}',
            '',
        ].join('\n'));

        await expect.poll(() => writes.length).toBe(1);
        expect(JSON.parse(writes[0] ?? '')).toMatchObject({ id: 'request-1', result: { accepted: true } });
        expect(received).toEqual([]);
        releaseFirst();
        await expect.poll(() => received).toEqual([1, 2]);
        protocol.dispose();
    });

    it('isolates throwing JSON-RPC notification subscribers from later subscribers', async () => {
        const { stdout, protocol } = createInMemoryJsonRpcProcess();
        const received: unknown[] = [];
        protocol.subscribeNotification(() => {
            throw new Error('subscriber failed');
        });
        protocol.subscribeNotification((message) => {
            received.push(message);
        });

        stdout.write('{"jsonrpc":"2.0","method":"host/status","params":{"ready":true}}\n');

        await expect.poll(() => received).toEqual([
            { method: 'host/status', params: { ready: true } },
        ]);
        protocol.dispose();
    });

    it('dispatches child-to-host JSON-RPC requests and writes responses', async () => {
        const { stdout, writes, protocol } = createInMemoryJsonRpcProcess();
        protocol.client.registerRequestHandler('host/question', (params, context) => ({
            accepted: params,
            requestId: context.requestId,
        }));

        stdout.write('{"jsonrpc":"2.0","id":"child-1","method":"host/question","params":{"value":7}}\n');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(writes).toHaveLength(1);
        expect(JSON.parse(writes[0] ?? '')).toEqual({
            jsonrpc: '2.0',
            id: 'child-1',
            result: { accepted: { value: 7 }, requestId: 'child-1' },
        });
        protocol.dispose();
    });

    it('rejects a second responder for the same JSON-RPC method before replacement', () => {
        const { protocol } = createInMemoryJsonRpcProcess();
        const unregister = protocol.client.registerRequestHandler('host/question', () => ({ first: true }));

        expect(() => protocol.client.registerRequestHandler('host/question', () => ({ second: true }))).toThrowError(
            expect.objectContaining({ code: 'PLUGIN_EXEC_CLIENT_DUPLICATE_HANDLER' }),
        );
        unregister();
        expect(() => protocol.client.registerRequestHandler('host/question', () => ({ replacement: true }))).not.toThrow();
        protocol.dispose();
    });

    it('rejects child-to-host JSON-RPC request handlers that return undefined results', async () => {
        const { stdout, writes, protocol } = createInMemoryJsonRpcProcess();
        protocol.client.registerRequestHandler('host/undefined', () => undefined as never);

        stdout.write('{"jsonrpc":"2.0","id":"child-1","method":"host/undefined","params":{}}\n');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(writes).toHaveLength(1);
        expect(JSON.parse(writes[0] ?? '')).toEqual({
            jsonrpc: '2.0',
            id: 'child-1',
            error: {
                code: -32000,
                message: 'JSON-RPC request handler for host/undefined returned undefined',
            },
        });
        protocol.dispose();
    });

    it('handles split and batched JSON-RPC response frames at the exec-client composition layer', async () => {
        const { stdout, protocol } = createInMemoryJsonRpcProcess();

        const first = protocol.client.request('child/one', {});
        const second = protocol.client.request('child/two', {});

        stdout.write('{"jsonrpc":"2.0","id":1,"res');
        stdout.write('ult":{"one":true}}\n{"jsonrpc":"2.0","id":2,"result":{"two":true}}\n');

        await expect(first).resolves.toEqual({ one: true });
        await expect(second).resolves.toEqual({ two: true });
        protocol.dispose();
    });

    it('reads and writes fragmented JSON-RPC content-length frames', async () => {
        const stdout = new PassThrough();
        const writes: Uint8Array[] = [];
        const processHandle: ExecProcessHandleV1 = {
            pid: 1,
            exit: new Promise(() => undefined),
            writeStdin: async () => undefined,
            kill: () => undefined,
            dispose: async () => undefined,
        };
        const protocol = createJsonRpcProcessClient({
            process: processHandle,
            stdout,
            framing: 'contentLength',
            maxFrameBytes: 256,
            write: async (value) => {
                writes.push(typeof value === 'string' ? new Uint8Array(Buffer.from(value)) : value);
            },
        });

        const pending = protocol.client.request('fixture/echo', { value: 3 });
        await expect.poll(() => writes.length).toBe(1);
        expect(Buffer.from(writes[0]!).toString('ascii')).toMatch(/^Content-Length: \d+\r\n\r\n/u);
        const response = encodeContentLengthFrame(new Uint8Array(Buffer.from(
            '{"jsonrpc":"2.0","id":1,"result":{"value":3}}',
        )));
        stdout.write(response.subarray(0, 7));
        stdout.write(response.subarray(7, 23));
        stdout.write(response.subarray(23));

        await expect(pending).resolves.toEqual({ value: 3 });
        protocol.dispose();
    });

    it('preserves child JSON-RPC response error code, message, data, and request method', async () => {
        const { stdout, protocol } = createInMemoryJsonRpcProcess();

        const pending = protocol.client.request('child/fail', { input: 'bad' });
        stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: {
                code: -32602,
                message: 'invalid params: unsupported structured input',
                data: { field: 'input' },
            },
        }) + '\n');

        await expect(pending).rejects.toMatchObject({
            code: -32602,
            message: 'invalid params: unsupported structured input',
            data: { field: 'input' },
            method: 'child/fail',
        });
        protocol.dispose();
    });

    it('rejects pending requests when the JSON-RPC stream ends with a trailing partial frame', async () => {
        const { stdout, protocol } = createInMemoryJsonRpcProcess();

        const pending = protocol.client.request('child/wait', {});
        stdout.end('{"jsonrpc":"2.0","id":1,"result":');

        await expect(pending).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_PROTOCOL_ERROR',
        });
    });

    it('redacts handler failure messages before writing JSON-RPC errors to the child', async () => {
        const { stdout, writes, protocol } = createInMemoryJsonRpcProcess();
        protocol.client.registerRequestHandler('host/secret', () => {
            throw new Error('failed with API_KEY=super-secret-token');
        });

        stdout.write('{"jsonrpc":"2.0","id":"child-1","method":"host/secret","params":{}}\n');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(writes).toHaveLength(1);
        const response = JSON.parse(writes[0] ?? '') as {
            error?: { message?: string };
        };
        expect(response).toMatchObject({
            jsonrpc: '2.0',
            id: 'child-1',
            error: {
                code: -32000,
            },
        });
        expect(response.error?.message).toContain('API_KEY=');
        expect(response.error?.message).not.toContain('super-secret-token');
        protocol.dispose();
    });

    it('applies provider-neutral JSON-RPC message hooks before dispatching incoming frames', async () => {
        const decisions: unknown[] = [];
        const { stdout, writes, protocol } = createInMemoryJsonRpcProcess({
            hooks: {
                onMessage: (message, context) => {
                    decisions.push({ message, context });
                    if ((message as { method?: unknown }).method === 'host/suppressed') {
                        return 'suppress';
                    }
                    if ((message as { method?: unknown }).method === 'host/replace') {
                        return {
                            kind: 'replace',
                            message: {
                                ...(message as Record<string, unknown>),
                                method: 'host/question',
                            },
                        };
                    }
                    return 'pass';
                },
            },
        });
        protocol.client.registerRequestHandler('host/suppressed', () => ({ shouldNotWrite: true }));
        protocol.client.registerRequestHandler('host/question', (params) => ({ accepted: params }));

        stdout.write('{"jsonrpc":"2.0","id":"child-1","method":"host/suppressed","params":{"value":1}}\n');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(writes).toEqual([]);

        stdout.write('{"jsonrpc":"2.0","id":"child-2","method":"host/replace","params":{"value":2}}\n');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(writes).toHaveLength(1);
        expect(JSON.parse(writes[0] ?? '')).toEqual({
            jsonrpc: '2.0',
            id: 'child-2',
            result: { accepted: { value: 2 } },
        });
        expect(decisions).toEqual([
            {
                message: {
                    jsonrpc: '2.0',
                    id: 'child-1',
                    method: 'host/suppressed',
                    params: { value: 1 },
                },
                context: { phase: 'incoming' },
            },
            {
                message: {
                    jsonrpc: '2.0',
                    id: 'child-2',
                    method: 'host/replace',
                    params: { value: 2 },
                },
                context: { phase: 'incoming' },
            },
            {
                message: {
                    jsonrpc: '2.0',
                    id: 'child-2',
                    result: { accepted: { value: 2 } },
                },
                context: { phase: 'outgoing' },
            },
        ]);
        protocol.dispose();
    });

    it('rejects pending requests when a malformed frame arrives', async () => {
        const { stdout, protocol } = createInMemoryJsonRpcProcess();

        const pending = protocol.client.request('child/work', {});
        stdout.write('not-json\n');

        await expect(pending).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_PROTOCOL_ERROR',
        });
    });

    it('rejects only the matching request when a newline-complete response is malformed', async () => {
        const onFailure = vi.fn();
        const { stdout, protocol } = createInMemoryJsonRpcProcess({ onFailure });

        const malformed = protocol.client.request('child/malformed', {});
        stdout.write('{"jsonrpc":"2.0","id":1,"result":{"payload":"unterminated}\n');

        await expect(malformed).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_PROTOCOL_ERROR',
        });

        const after = protocol.client.request('child/after', {});
        stdout.write('{"jsonrpc":"2.0","id":2,"result":{"alive":true}}\n');
        await expect(after).resolves.toEqual({ alive: true });
        expect(onFailure).not.toHaveBeenCalled();
        protocol.dispose();
    });

    it('fatally rejects a malformed child request even when its id matches a pending host request', async () => {
        const onFailure = vi.fn();
        const { stdout, protocol } = createInMemoryJsonRpcProcess({ onFailure });

        const pending = protocol.client.request('child/pending', {});
        stdout.write('{"jsonrpc":"2.0","id":1,"method":"host/request","params":{"payload":"unterminated}\n');

        await expect(pending).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_PROTOCOL_ERROR',
        });
        expect(onFailure).toHaveBeenCalledTimes(1);
    });

    it('bounds unresolved outgoing JSON-RPC request correlation', async () => {
        const { protocol } = createInMemoryJsonRpcProcess();
        const pending = Array.from({ length: 256 }, (_, index) => (
            protocol.client.request(`child/pending-${index}`, {}, { timeoutMs: 10_000 }).catch((error: unknown) => error)
        ));

        await expect(protocol.client.request('child/overflow', {}, { timeoutMs: 10_000 })).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_BACKPRESSURE_EXCEEDED',
        });

        protocol.dispose();
        await Promise.all(pending);
    });

    it('lets request timeout settle while the stdin write remains blocked', async () => {
        const stdout = new PassThrough();
        const protocol = createJsonRpcProcessClient({
            process: {
                pid: 1,
                exit: new Promise(() => undefined),
                writeStdin: async () => await new Promise<void>(() => undefined),
                kill: () => undefined,
                dispose: async () => undefined,
            },
            stdout,
            write: async () => await new Promise<void>(() => undefined),
            requestTimeoutMs: 1,
        });

        await expect(protocol.client.request('child/blocked-write', {})).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_REQUEST_TIMEOUT',
        });
        protocol.dispose();
    });

    it('bounds concurrent child-to-host JSON-RPC request handlers', async () => {
        const onFailure = vi.fn();
        const { stdout, protocol } = createInMemoryJsonRpcProcess({ onFailure });
        const neverSettles = new Promise<never>(() => undefined);
        protocol.client.registerRequestHandler('host/hang', () => neverSettles);

        for (let id = 1; id <= 257; id += 1) {
            stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: `child-${id}`, method: 'host/hang' })}\n`);
        }

        await vi.waitFor(() => expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
            code: 'PLUGIN_EXEC_CLIENT_BACKPRESSURE_EXCEEDED',
        })));
        protocol.dispose();
    });

    it('rejects outgoing JSON-RPC frames above maxFrameBytes before writing stdin', async () => {
        const { writes, protocol } = createInMemoryJsonRpcProcess({ maxFrameBytes: 96 });

        await expect(protocol.client.notify('child/huge', { payload: 'x'.repeat(128) })).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_PROTOCOL_ERROR',
            message: expect.stringContaining('exceeded the configured size limit'),
        });
        expect(writes).toEqual([]);
        protocol.dispose();
    });

    it('rejects only the matching JSON-RPC request when a response frame exceeds maxFrameBytes before newline', async () => {
        const { stdout, protocol } = createInMemoryJsonRpcProcess({ maxFrameBytes: 64 });

        const oversized = protocol.client.request('child/huge', {}, { timeoutMs: 1000 });
        stdout.write('{"jsonrpc":"2.0","id":1,"result":{"payload":"');
        stdout.write('x'.repeat(128));

        await expect(oversized).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_PROTOCOL_ERROR',
            message: expect.stringContaining('exceeded the configured size limit'),
        });

        const next = protocol.client.request('child/ok', {});
        stdout.write('discarded-rest"} }\n');
        stdout.write('{"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n');

        await expect(next).resolves.toEqual({ ok: true });
        protocol.dispose();
    });

    it('correlates an oversized response only from its top-level id', async () => {
        const { stdout, protocol } = createInMemoryJsonRpcProcess({ maxFrameBytes: 96 });
        const first = protocol.client.request('child/first', {}, { timeoutMs: 1_000 });
        const second = protocol.client.request('child/second', {}, { timeoutMs: 1_000 });
        stdout.write('{"jsonrpc":"2.0","result":{"id":2},"id":1,"payload":"');
        stdout.write('x'.repeat(128));

        await expect(first).rejects.toMatchObject({ code: 'PLUGIN_EXEC_CLIENT_PROTOCOL_ERROR' });
        stdout.write('discarded"}\n');
        stdout.write('{"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n');
        await expect(second).resolves.toEqual({ ok: true });
        protocol.dispose();
    });

    it('rejects pending requests on request timeout', async () => {
        const { protocol } = createInMemoryJsonRpcProcess();

        await expect(protocol.client.request('child/slow', {}, { timeoutMs: 1 })).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_REQUEST_TIMEOUT',
        });
        protocol.dispose();
    });

    it('leaves a dispatched request pending when its timeout is explicitly disabled', async () => {
        vi.useFakeTimers();
        const { stdout, protocol } = createInMemoryJsonRpcProcess();
        try {
            let settled = false;
            const pending = protocol.client.request('child/slow', {}, { timeoutMs: null }).finally(() => {
                settled = true;
            });

            await vi.advanceTimersByTimeAsync(26);
            expect(settled).toBe(false);

            stdout.write('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n');
            await expect(pending).resolves.toEqual({ ok: true });
        } finally {
            protocol.dispose();
            vi.useRealTimers();
        }
    });

    it('does not write JSON-RPC requests when the request signal is already aborted', async () => {
        const { writes, protocol } = createInMemoryJsonRpcProcess();
        const abortController = new AbortController();
        abortController.abort();

        await expect(protocol.client.request('child/aborted', {}, { signal: abortController.signal })).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_ABORTED',
        });

        expect(writes).toEqual([]);
        protocol.dispose();
    });

    it('rejects pending requests when the process exits', async () => {
        const { protocol } = createInMemoryJsonRpcProcess();

        const pending = protocol.client.request('child/wait', {});
        protocol.settleExit(new PluginExecClientError('PLUGIN_EXEC_CLIENT_EXITED', 'process exited'));

        await expect(pending).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_EXITED',
        });
    });

});
