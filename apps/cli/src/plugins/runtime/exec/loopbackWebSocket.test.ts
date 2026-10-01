import { createServer, type AddressInfo, type Socket } from 'node:net';
import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import type {
    ExecLoopbackWebSocketEndpointV1,
    ExecLoopbackWebSocketJsonClientSpecV1,
    ExecProcessHandleV1,
} from './privateContract';

import { encodeLoopbackHandshakeFrame } from './loopbackHandshake';
import {
    createLoopbackWebSocketJsonClient,
    createLoopbackWebSocketProcessClient,
} from './loopbackWebSocket';

async function createRawLoopbackProbe(): Promise<{
    readonly port: number;
    readonly received: () => Buffer;
    readonly close: () => Promise<void>;
}> {
    const chunks: Buffer[] = [];
    const server = createServer((socket) => {
        socket.on('data', (chunk) => {
            chunks.push(Buffer.from(chunk));
            socket.destroy();
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address() as AddressInfo;
    return {
        port: address.port,
        received: () => Buffer.concat(chunks),
        close: async () => {
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        },
    };
}

async function createHangingUpgradeServer(): Promise<{
    readonly port: number;
    readonly close: () => Promise<void>;
}> {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => {
            sockets.delete(socket);
        });
        socket.on('data', () => {
            // Accept the TCP connection and request bytes but never complete the
            // WebSocket upgrade.
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address() as AddressInfo;
    return {
        port: address.port,
        close: async () => {
            for (const socket of sockets) {
                socket.destroy();
            }
            await new Promise<void>((resolve, reject) => {
                server.close((error) => (error ? reject(error) : resolve()));
            });
        },
    };
}

function decodeHandshake(bytes: Uint8Array): {
    host?: string;
    port?: number;
    path?: string;
    protocol?: string;
    apiKey?: string;
    url?: string;
} {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

function createSpec(
    executablePath: string,
    config: Record<string, unknown>,
): ExecLoopbackWebSocketJsonClientSpecV1<ExecLoopbackWebSocketEndpointV1> {
    const apiKey = typeof config.apiKey === 'string' ? config.apiKey : 'fixture-loopback-key';
    const byteOrder = config.byteOrder === 'big-endian' ? 'big-endian' : 'little-endian';
    return {
        launch: {
            kind: 'binary',
            executablePath: process.execPath,
            args: [executablePath],
            env: {
                HAPPIER_LOOPBACK_WS_FIXTURE_CONFIG: JSON.stringify({ ...config, apiKey }),
            },
        },
        transport: {
            kind: 'spawned-loopback-websocket',
            handshake: {
                byteOrder,
                requestFrames: [Uint8Array.from([0x61, 0x62, 0x63])],
                response: {
                    byteOrder,
                    maxFrameBytes: 4096,
                    // The fixture spawns a fresh Node process; leave startup
                    // scheduling headroom while dedicated timeout cases retain
                    // their explicit short deadlines below.
                    timeoutMs: 1_500,
                },
            },
            connect: {
                timeoutMs: 600,
                retryInitialDelayMs: 5,
                retryMaxDelayMs: 25,
            },
            shutdown: {
                kind: 'close-stdin',
                graceMs: 300,
            },
            limits: {
                maxMessageBytes: 2048,
                maxPendingMessages: 8,
                maxBufferedBytes: 4096,
            },
        },
        protocol: {
            kind: 'json-websocket',
            endpoint: {
                decodeHandshakeResponse: decodeHandshake,
                buildHeaders(endpoint) {
                    const endpointApiKey = typeof endpoint.apiKey === 'string' ? endpoint.apiKey : apiKey;
                    return [
                        {
                            name: 'x-loopback-api-key',
                            value: endpointApiKey,
                            sensitive: true,
                        },
                    ];
                },
            },
        },
        lifecycle: {
            maxStderrBytes: 256,
            diagnostics: {
                sanitizer: {
                    redactedValues: [apiKey, String(config.secret ?? '')].filter((value) => value.length > 0),
                },
            },
        },
    };
}

function createAlreadyFlowingHandshakeProcess(
    responseFrame: Buffer,
): {
    readonly process: Parameters<typeof createLoopbackWebSocketProcessClient>[0]['process'];
    readonly wroteStdin: () => boolean;
} {
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    let stdinWritten = false;

    stdout.on('data', () => {
        // Simulates the generic bounded stdout diagnostics capture already flowing.
    });

    const exit = new Promise<Awaited<ExecProcessHandleV1['exit']>>(() => {
        // Keep the synthetic child alive long enough for the handshake timeout path.
    });
    const handle: ExecProcessHandleV1 = {
        pid: 12_345,
        exit,
        writeStdin: async () => {
            stdinWritten = true;
            stdout.write(responseFrame);
        },
        kill: () => false,
        dispose: async () => undefined,
    };

    return {
        process: {
            child: {
                stdin,
                stdout,
            },
            handle,
            readStderrPreview: () => 'synthetic stderr preview with token <redacted>',
        },
        wroteStdin: () => stdinWritten,
    };
}

describe('A.13p.10 spawned loopback WebSocket client transport', () => {
    it('does not lose a synchronous child handshake response when stdout diagnostics are already flowing', async () => {
        const responseFrame = encodeLoopbackHandshakeFrame(
            Buffer.from(JSON.stringify({
                host: 'example.com',
                port: 12_345,
                path: '/runtime',
                apiKey: 'race-key',
            })),
            'little-endian',
        );
        const fake = createAlreadyFlowingHandshakeProcess(responseFrame);
        const spec = createSpec(process.execPath, { apiKey: 'race-key' });

        await expect(createLoopbackWebSocketProcessClient({
            spec: {
                ...spec,
                transport: {
                    ...spec.transport,
                    handshake: {
                        ...spec.transport.handshake,
                        response: {
                            ...spec.transport.handshake.response,
                            timeoutMs: 25,
                        },
                    },
                },
            },
            process: fake.process,
        })).rejects.toMatchObject({
            code: 'PLUGIN_EXEC_CLIENT_PROTOCOL_ERROR',
        });
        expect(fake.wroteStdin()).toBe(true);
    });

    it('rejects endpoint paths with HTTP control characters before sending a WebSocket upgrade request', async () => {
        const probe = await createRawLoopbackProbe();
        try {
            const responseFrame = encodeLoopbackHandshakeFrame(
                Buffer.from(JSON.stringify({
                    host: '127.0.0.1',
                    port: probe.port,
                    path: '/runtime\r\nX-Injected: yes',
                    apiKey: 'path-injection-key',
                })),
                'little-endian',
            );
            const fake = createAlreadyFlowingHandshakeProcess(responseFrame);
            const spec = createSpec(process.execPath, { apiKey: 'path-injection-key' });

            await expect(createLoopbackWebSocketProcessClient({
                spec: {
                    ...spec,
                    transport: {
                        ...spec.transport,
                        connect: {
                            timeoutMs: 40,
                            retryInitialDelayMs: 5,
                            retryMaxDelayMs: 5,
                        },
                    },
                },
                process: fake.process,
            })).rejects.toMatchObject({
                code: 'PLUGIN_EXEC_CLIENT_PROTOCOL_ERROR',
            });
            expect(probe.received().toString('latin1')).toBe('');
        } finally {
            await probe.close();
        }
    });

    it('does not retry a completed socket upgrade failure as loopback readiness', async () => {
        const probe = await createRawLoopbackProbe();
        try {
            const responseFrame = encodeLoopbackHandshakeFrame(
                Buffer.from(JSON.stringify({
                    host: '127.0.0.1',
                    port: probe.port,
                    path: '/runtime',
                    apiKey: 'upgrade-rejected-key',
                })),
                'little-endian',
            );
            const fake = createAlreadyFlowingHandshakeProcess(responseFrame);
            const spec = createSpec(process.execPath, { apiKey: 'upgrade-rejected-key' });

            await expect(createLoopbackWebSocketProcessClient({
                spec: {
                    ...spec,
                    transport: {
                        ...spec.transport,
                        connect: {
                            timeoutMs: 80,
                            retryInitialDelayMs: 5,
                            retryMaxDelayMs: 5,
                        },
                    },
                },
                process: fake.process,
            })).rejects.toMatchObject({
                code: 'PLUGIN_EXEC_CLIENT_PROTOCOL_ERROR',
            });
        } finally {
            await probe.close();
        }
    });

    it('times out when a loopback socket accepts TCP but never completes the WebSocket upgrade', async () => {
        const server = await createHangingUpgradeServer();
        const connectPromise = createLoopbackWebSocketJsonClient({
            endpoint: { url: `ws://127.0.0.1:${server.port}/runtime` },
            connect: {
                timeoutMs: 35,
                retryInitialDelayMs: 5,
                retryMaxDelayMs: 5,
            },
        });
        connectPromise.catch(() => undefined);

        try {
            const result: unknown = await Promise.race([
                connectPromise.catch((error: unknown) => error),
                new Promise((resolve) => {
                    setTimeout(() => resolve({ status: 'still_pending' }), 120);
                }),
            ]);

            expect(result).toMatchObject({
                code: 'PLUGIN_EXEC_CLIENT_REQUEST_TIMEOUT',
            });
        } finally {
            await server.close();
        }
    });

});
