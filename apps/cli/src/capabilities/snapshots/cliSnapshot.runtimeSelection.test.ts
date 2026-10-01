import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import {
    resolveAgentCliJavaScriptRuntimeOnDaemonPath as resolveJavaScriptRuntimeExecutableForCliSnapshot,
    isAgentCliPathRunnableOnDaemonPath,
} from '@/packagedRuntime/managedTools/agentCliResolution';

test.skipIf(process.platform === 'win32')('snapshot runtime selection refuses PATH Node but keeps the explicit managed runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'snapshot-runtime-'));
    const bin = join(root, 'bin');
    await mkdir(bin);
    const cli = join(bin, 'fixture-cli');
    const node = join(bin, 'node');
    const managed = join(root, 'managed-node');
    await writeFile(cli, '#!/usr/bin/env node\n', { mode: 0o755 });
    for (const path of [node, managed]) await writeFile(path, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const execPath = Object.getOwnPropertyDescriptor(process, 'execPath');
    const bun = Object.getOwnPropertyDescriptor(process.versions, 'bun');
    vi.stubEnv('HOME', root);
    vi.stubEnv('HAPPIER_HOME_DIR', root);
    vi.stubEnv('PATH', bin);
    vi.stubEnv('HAPPIER_JS_RUNTIME_PATH', '');
    vi.stubEnv('HAPPIER_MANAGED_NODE_BIN', '');
    vi.stubEnv('HAPPIER_NODE_PATH', '');
    Object.defineProperty(process, 'execPath', { configurable: true, value: join(root, 'happier') });
    Object.defineProperty(process.versions, 'bun', { configurable: true, value: '1.2.23' });
    try {
        await expect(resolveJavaScriptRuntimeExecutableForCliSnapshot(cli)).resolves.toBeNull();
        await expect(isAgentCliPathRunnableOnDaemonPath(cli)).resolves.toBe(false);
        vi.stubEnv('HAPPIER_MANAGED_NODE_BIN', managed);
        await expect(resolveJavaScriptRuntimeExecutableForCliSnapshot(cli)).resolves.toBe(managed);
        await expect(isAgentCliPathRunnableOnDaemonPath(cli)).resolves.toBe(true);
    } finally {
        if (execPath) Object.defineProperty(process, 'execPath', execPath);
        if (bun) Object.defineProperty(process.versions, 'bun', bun);
        else delete process.versions.bun;
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
    }
});
