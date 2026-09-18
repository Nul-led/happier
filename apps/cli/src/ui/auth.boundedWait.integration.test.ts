import fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleLogAndMuteStdout, captureConsoleText } from '@/testkit/logger/captureOutput';
import { setStdioTtyForTest } from '@/testkit/process/stdio';

function pendingRelay() {
    const app = fastify({ logger: false });
    app.get('/v1/features', async (_req, reply) => reply.send({
        features: {},
        capabilities: { serverIdentity: { serverIdentityId: 'srv_auth_bounded_wait' } },
    }));
    app.post('/v1/auth/request', async (_req, reply) => reply.send({ state: 'requested' }));
    app.get('/v1/auth/request/status', async (_req, reply) => reply.send({ status: 'pending', supportsV2: true }));
    return app;
}

function setStderrTtyForTest(isTTY: boolean): () => void {
    const descriptor = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
    Object.defineProperty(process.stderr, 'isTTY', { value: isTTY, configurable: true });
    return () => {
        if (descriptor) Object.defineProperty(process.stderr, 'isTTY', descriptor);
        else delete (process.stderr as { isTTY?: boolean }).isTTY;
    };
}

describe('terminal auth wait bound', () => {
    const envKeys = [
        'HAPPIER_HOME_DIR',
        'HAPPIER_NO_BROWSER_OPEN',
        'HAPPIER_AUTH_METHOD',
        'HAPPIER_AUTH_POLL_INTERVAL_MS',
        'HAPPIER_AUTH_WAIT_TIMEOUT_MS',
        'HAPPIER_NO_ANIMATION',
        'HAPPIER_SERVER_URL',
        'HAPPIER_WEBAPP_URL',
        'NO_COLOR',
        'TERM',
    ] as const;

    let restoreTty: (() => void) | null = null;
    let restoreStderrTty: (() => void) | null = null;
    let homeDir = '';
    let envScope = createEnvKeyScope(envKeys);

    beforeEach(async () => {
        vi.useRealTimers();
        envScope = createEnvKeyScope(envKeys);
        homeDir = await createTempDir('happier-cli-auth-bounded-wait-');
        envScope.patch({
            HAPPIER_HOME_DIR: homeDir,
            HAPPIER_NO_BROWSER_OPEN: '1',
            HAPPIER_AUTH_METHOD: 'web',
            HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
            HAPPIER_SERVER_URL: 'http://happier-auth-bounded.test',
            HAPPIER_WEBAPP_URL: 'http://example.test',
        });
        restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    });

    afterEach(async () => {
        restoreTty?.();
        restoreTty = null;
        restoreStderrTty?.();
        restoreStderrTty = null;
        envScope.restore();
        vi.resetModules();
        vi.unstubAllGlobals();
        await removeTempDir(homeDir);
    });

    it('stops waiting once the caller-set bound elapses and names the way back in', async () => {
        envScope.patch({ HAPPIER_AUTH_WAIT_TIMEOUT_MS: '200' });

        const app = pendingRelay();
        const origin = await app.listen({ host: '127.0.0.1', port: 0 });
        envScope.patch({ HAPPIER_SERVER_URL: origin });
        vi.resetModules();
        const { doAuth } = await import('./auth');

        const output = captureConsoleText();
        try {
            const startedAt = performance.now();
            const result = await doAuth();
            const elapsedMs = performance.now() - startedAt;

            expect(result).toBeNull();
            expect(elapsedMs).toBeLessThan(2_000);
            const logs = output.text().toLowerCase();
            expect(logs).not.toContain('\r');
            expect(logs).toContain('happier auth login');
            expect(logs).toContain('create a new sign-in request');
            expect(logs).not.toContain('approve it on your phone');
        } finally {
            output.restore();
            await app.close().catch(() => {});
        }
    }, 60_000);

    it('keeps QR approval on compact progress so the code stays visible', async () => {
        envScope.patch({
            HAPPIER_AUTH_METHOD: undefined,
            HAPPIER_AUTH_WAIT_TIMEOUT_MS: '200',
            HAPPIER_NO_ANIMATION: '',
            NO_COLOR: '1',
            TERM: 'xterm-256color',
        });
        restoreTty?.();
        restoreTty = setStdioTtyForTest({ stdin: false, stdout: true });
        restoreStderrTty = setStderrTtyForTest(true);

        const app = pendingRelay();
        const origin = await app.listen({ host: '127.0.0.1', port: 0 });
        envScope.patch({ HAPPIER_SERVER_URL: origin });
        vi.resetModules();
        const { doAuth } = await import('./auth');

        const output = captureConsoleText();
        const clear = vi.spyOn(console, 'clear');
        try {
            await expect(doAuth()).resolves.toBeNull();
            const text = output.text();
            expect(text).toContain('Scan this QR code');
            expect(text).toContain('- [|] Waiting for authentication');
            expect(clear).not.toHaveBeenCalled();
        } finally {
            clear.mockRestore();
            output.restore();
            await app.close().catch(() => {});
        }
    }, 60_000);

    it('stops an in-flight terminal wait when the caller cancels', async () => {
        const app = pendingRelay();
        const origin = await app.listen({ host: '127.0.0.1', port: 0 });
        envScope.patch({ HAPPIER_SERVER_URL: origin });
        vi.resetModules();
        const { AuthenticationCancelledError, doAuth } = await import('./auth');
        const controller = new AbortController();

        const output = captureConsoleLogAndMuteStdout();
        try {
            const pending = doAuth({ callerIntent: 'setup-managed', signal: controller.signal });
            setTimeout(() => controller.abort(), 50);
            await expect(pending).rejects.toBeInstanceOf(AuthenticationCancelledError);
        } finally {
            output.restore();
            await app.close().catch(() => {});
        }
    }, 60_000);

    it('keeps waiting when no bound was asked for', async () => {
        const app = pendingRelay();
        const origin = await app.listen({ host: '127.0.0.1', port: 0 });
        envScope.patch({ HAPPIER_SERVER_URL: origin });
        vi.resetModules();
        const { doAuth } = await import('./auth');

        const output = captureConsoleLogAndMuteStdout();
        try {
            const settled = await Promise.race([
                doAuth().then(() => 'settled' as const),
                new Promise<'still-waiting'>((resolve) => setTimeout(() => resolve('still-waiting'), 750)),
            ]);

            expect(settled).toBe('still-waiting');
        } finally {
            output.restore();
            await app.close().catch(() => {});
        }
    }, 30_000);
});
