import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChildProcess } from 'node:child_process';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    return {
        ...actual,
        execFile: execFileMock,
    };
});

function mockProcessPlatform(platform: NodeJS.Platform): () => void {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', {
        configurable: true,
        value: platform,
    });
    return () => {
        if (descriptor) {
            Object.defineProperty(process, 'platform', descriptor);
        }
    };
}

describe('createLocalServicesDaemonRuntime platform scanner dispatch', () => {
    afterEach(() => {
        execFileMock.mockReset();
        vi.resetModules();
    });

    it('uses the Windows platform scanner for win32 default inventory refreshes', async () => {
        const restorePlatform = mockProcessPlatform('win32');
        execFileMock.mockImplementation((
            command: string,
            _args: readonly string[],
            _options: Readonly<{ maxBuffer: number }>,
            callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
            // The real execFile boundary returns a child before asynchronously delivering output
            // and close; the deadline adapter waits for both the callback and that close event.
            const child = new ChildProcess();
            const complete = (error: Error | null, stdout: string) => {
                queueMicrotask(() => {
                    Object.defineProperty(child, 'exitCode', { configurable: true, value: error ? 1 : 0 });
                    child.emit('exit', child.exitCode, null);
                    callback(error, stdout, '');
                    child.emit('close', child.exitCode, null);
                });
                return child;
            };
            if (command === 'netstat.exe') {
                return complete(null, [
                    '  Proto  Local Address          Foreign Address        State           PID',
                    '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       1234',
                ].join('\r\n'));
            }
            if (command === 'powershell.exe') {
                return complete(null, JSON.stringify([{
                    ProcessId: 1234,
                    ParentProcessId: 100,
                    CommandLine: 'npm run dev',
                    ExecutablePath: 'C:\\Program Files\\nodejs\\node.exe',
                }]));
            }
            return complete(new Error(`unexpected command ${command}`), '');
        });

        try {
            const { createLocalServicesDaemonRuntime } = await import('./runtime');
            const runtime = createLocalServicesDaemonRuntime({
                machineId: 'machine-win',
                inventoryEnabled: () => true,
                workspaceFacts: () => [],
                now: () => 2_000,
                startLoop: false,
            });

            const snapshot = await runtime.refreshInventoryNow();

            expect(snapshot.diagnostics).toEqual([]);
            expect(snapshot.entries[0]).toMatchObject({
                id: 'machine-win:tcp:loopback:127.0.0.1:5173:pid-1234:start-unknown',
                state: 'listening',
                provenance: {
                    process: {
                        pid: 1234,
                        ppid: 100,
                        command: 'npm run dev',
                        redacted: true,
                    },
                },
            });
            // No `timeout` is handed to Node: its timeout kill destroys the child's stdout from the
            // timers phase and still reports success, so a scan cut short by a stalled event loop
            // would arrive as an authoritative empty listing. The scan boundary owns the deadline.
            expect(execFileMock).toHaveBeenCalledWith('netstat.exe', ['-ano', '-p', 'tcp'], {
                maxBuffer: 1024 * 1024,
            }, expect.any(Function));
        } finally {
            restorePlatform();
        }
    });
});
