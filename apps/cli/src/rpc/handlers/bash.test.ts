import { tmpdir } from 'node:os';
import { realpath } from 'node:fs/promises';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { describe, expect, it } from 'vitest';

import { registerBashHandler } from './bash';

function createRegistrar() {
    const handlers = new Map<string, (payload: unknown) => Promise<unknown>>();
    return {
        handlers,
        registrar: {
            registerHandler(method: string, handler: (payload: unknown) => Promise<unknown>) {
                handlers.set(method, handler);
            },
        },
    };
}

/** A marker with no shell metacharacters, so `sh -c` parses the probe commands verbatim. */
const SHELL_MARKER = 'FOREGROUND-5199';

/**
 * Settle-or-give-up, so a handler that never answers fails with a readable assertion rather than
 * a bare vitest timeout (which under this machine's load is not a distinguishable signal).
 */
async function settleWithin<T>(
    pending: Promise<T>,
    capMs: number,
): Promise<{ kind: 'settled'; value: T } | { kind: 'still-waiting' }> {
    let capTimer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<{ kind: 'still-waiting' }>((resolve) => {
        capTimer = setTimeout(() => resolve({ kind: 'still-waiting' }), capMs);
    });
    try {
        return await Promise.race([
            pending.then((value) => ({ kind: 'settled' as const, value })),
            cap,
        ]);
    } finally {
        if (capTimer) clearTimeout(capTimer);
    }
}

describe('registerBashHandler', () => {
    it('runs argv payloads without going through the default shell', async () => {
        const { handlers, registrar } = createRegistrar();
        registerBashHandler(registrar as never, process.cwd());
        const handler = handlers.get(RPC_METHODS.BASH);
        expect(handler).toBeDefined();

        const argument = 'C:/repo/feature branch; $(shell-input)';
        await expect(handler!({
            argv: [process.execPath, '-e', 'process.stdout.write(process.argv[1])', argument],
            cwd: process.cwd(),
        })).resolves.toEqual({
            success: true,
            stdout: argument,
            stderr: '',
            exitCode: 0,
        });
    });

    it('allows cwd outside the default directory under the os-user filesystem policy', async () => {
        const { handlers, registrar } = createRegistrar();
        registerBashHandler(registrar as never, '/work/default', { accessPolicy: { kind: 'osUser' } });
        const handler = handlers.get(RPC_METHODS.BASH);
        expect(handler).toBeDefined();

        const outsideDirectory = await realpath(tmpdir());
        await expect(handler!({ argv: [process.execPath, '-e', 'process.stdout.write(process.cwd())'], cwd: outsideDirectory })).resolves.toMatchObject({
            success: true,
            stdout: outsideDirectory,
        });
    });
    // A shell RPC whose caller backgrounds a process is normal, expected use — and `sh` forks for
    // anything that is not a single exec-replaceable command, so the survivor holding the stdout
    // pipe is the common shape, not an exotic one. The handler owes the caller the FOREGROUND
    // command's output and status; it does not owe them a wait on a pipe a `sleep` inherited.
    it.skipIf(process.platform === 'win32')(
        'answers as soon as the command exits, even when the command left a process holding its output pipe',
        async () => {
            const { handlers, registrar } = createRegistrar();
            registerBashHandler(registrar as never, process.cwd());
            const handler = handlers.get(RPC_METHODS.BASH)!;

            const outcome = await settleWithin(
                handler({ command: `echo ${SHELL_MARKER}; sleep 20 & exit 0`, cwd: process.cwd() }),
                3_000,
            );

            expect(outcome.kind).toBe('settled');
            expect((outcome as { value: { success: boolean; stdout: string } }).value).toMatchObject({
                success: true,
                exitCode: 0,
            });
            // Never an empty "success": the command ran and this is what it printed.
            expect((outcome as { value: { stdout: string } }).value.stdout).toContain(SHELL_MARKER);
        },
    );

    it.skipIf(process.platform === 'win32')(
        'reports a genuinely hung command as timed out instead of waiting on the pipe its survivor holds',
        async () => {
            const { handlers, registrar } = createRegistrar();
            registerBashHandler(registrar as never, process.cwd());
            const handler = handlers.get(RPC_METHODS.BASH)!;

            const outcome = await settleWithin(
                handler({ command: `echo ${SHELL_MARKER}; sleep 20 & sleep 20`, cwd: process.cwd(), timeout: 500 }),
                3_000,
            );

            expect(outcome.kind).toBe('settled');
            expect((outcome as { value: { success: boolean; error?: string } }).value).toMatchObject({
                success: false,
                error: 'Command timed out',
            });
            // The timeout keeps what the command had already printed rather than reporting nothing.
            expect((outcome as { value: { stdout: string } }).value.stdout).toContain(SHELL_MARKER);
        },
    );

    it.skipIf(process.platform === 'win32')(
        'answers an argv payload when the command exits, not when a process it left running releases the pipe',
        async () => {
            const { handlers, registrar } = createRegistrar();
            registerBashHandler(registrar as never, process.cwd());
            const handler = handlers.get(RPC_METHODS.BASH)!;

            const outcome = await settleWithin(
                handler({
                    argv: ['sh', '-c', `echo ${SHELL_MARKER}; sleep 20 & exit 0`],
                    cwd: process.cwd(),
                    timeout: 1_000,
                }),
                3_000,
            );

            // Waiting on the survivor's pipe made this worse than slow: past its own budget the
            // argv path reported `success: false, error: 'Command timed out'` for a command that
            // exited 0 in ten milliseconds — a false FAILURE, the mirror of the false success.
            expect(outcome.kind).toBe('settled');
            expect((outcome as { value: { success: boolean } }).value).toMatchObject({
                success: true,
                exitCode: 0,
            });
            expect((outcome as { value: { stdout: string } }).value.stdout).toContain(SHELL_MARKER);
        },
    );

    it.skipIf(process.platform === 'win32')('preserves successful argv output when the host event loop stalls past its deadline', async () => {
        const { handlers, registrar } = createRegistrar();
        registerBashHandler(registrar as never, process.cwd());
        const pending = handlers.get(RPC_METHODS.BASH)!({ argv: ['/bin/echo', SHELL_MARKER], timeout: 200 });
        const until = Date.now() + 1_500;
        while (Date.now() < until) { /* Reproduce a stalled daemon timers phase. */ }
        await expect(pending).resolves.toMatchObject({ success: true, exitCode: 0, stdout: `${SHELL_MARKER}\n` });
    });

    it('preserves argv output larger than the buffered-execution default', async () => {
        const { handlers, registrar } = createRegistrar();
        registerBashHandler(registrar as never, process.cwd());
        const output = 'x'.repeat(1_200_000);
        await expect(handlers.get(RPC_METHODS.BASH)!({
            argv: [process.execPath, '-e', `process.stdout.write('x'.repeat(${output.length}))`],
        })).resolves.toEqual({ success: true, stdout: output, stderr: '', exitCode: 0 });
    });

    it.each(['', 'refused'])('preserves a completed argv failure and its partial output (stderr: %s)', async (stderr) => {
        const { handlers, registrar } = createRegistrar();
        registerBashHandler(registrar as never, process.cwd());
        await expect(handlers.get(RPC_METHODS.BASH)!({
            argv: [process.execPath, '-e', `process.stdout.write('partial'); process.stderr.write(${JSON.stringify(stderr)}); process.exitCode = 7;`],
        })).resolves.toEqual({ success: false, stdout: 'partial', stderr: stderr || 'Command failed', exitCode: 7, error: stderr || 'Command failed' });
    });

    it('retains the invalid executable response instead of treating it as a spawn failure', async () => {
        const { handlers, registrar } = createRegistrar();
        registerBashHandler(registrar as never, process.cwd());
        await expect(handlers.get(RPC_METHODS.BASH)!({ argv: [''] })).resolves.toMatchObject({ success: false, exitCode: 1 });
    });

    it('reports an executable that cannot be spawned as a failure', async () => {
        const { handlers, registrar } = createRegistrar();
        registerBashHandler(registrar as never, process.cwd());
        await expect(handlers.get(RPC_METHODS.BASH)!({ argv: ['happier-missing-executable-fixture'] })).resolves.toMatchObject({ success: false, stdout: '', exitCode: -1 });
    });

    it.skipIf(process.platform === 'win32')('reports argv deadline interruption even when the command traps SIGTERM and exits zero', async () => {
        const { handlers, registrar } = createRegistrar();
        registerBashHandler(registrar as never, process.cwd());
        await expect(handlers.get(RPC_METHODS.BASH)!({
            argv: ['/bin/sh', '-c', 'trap "exit 0" TERM; echo started; while :; do sleep 0.1; done'],
            timeout: 250,
        })).resolves.toEqual({ success: false, stdout: 'started\n', stderr: '', exitCode: 0, error: 'Command timed out' });
    });
});
