import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    installVersionedPayload,
    readInstalledVersionMarkers,
    resolveDefaultManagedReleaseChannelStatePath,
    resolveFirstPartyInstallLayout,
} from './index.js';

async function createPayload(rootDir: string, versionId: string, contents: string, binaryName = 'happier'): Promise<string> {
    const payloadRoot = join(rootDir, `payload-${versionId}`);
    await mkdir(join(payloadRoot, 'package-dist'), { recursive: true });
    await writeFile(join(payloadRoot, binaryName), contents, 'utf8');
    await writeFile(join(payloadRoot, 'package-dist', 'index.mjs'), `export default ${JSON.stringify(versionId)};\n`, 'utf8');
    return payloadRoot;
}

async function readJsonReleaseChannel(path: string): Promise<string> {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw).releaseChannel;
}

describe('installVersionedPayload default release-channel persistence', () => {
    it('rejects cancellation before installation without changing the current payload, shims, or markers', async () => {
        const homeDir = await mkdtemp(join(tmpdir(), 'happier-install-cancel-before-'));
        const env = { ...process.env, HAPPIER_HOME_DIR: homeDir };
        const layout = resolveFirstPartyInstallLayout({ componentId: 'happier-cli', processEnv: env });
        const binaryName = process.platform === 'win32' ? 'happier.exe' : 'happier';
        try {
            await installVersionedPayload({
                componentId: 'happier-cli', versionId: '1.0.0', processEnv: env,
                payloadRoot: await createPayload(homeDir, '1.0.0', 'original-version', binaryName),
            });
            const controller = new AbortController();
            controller.abort();
            const phases: string[] = [];
            await expect(installVersionedPayload({
                componentId: 'happier-cli', versionId: '2.0.0', processEnv: env,
                payloadRoot: await createPayload(homeDir, '2.0.0', 'cancelled-version', binaryName),
                signal: controller.signal, onProgress: ({ phase }) => { phases.push(phase); },
            })).rejects.toMatchObject({ name: 'AbortError' });
            expect(phases).toEqual([]);
            expect(await readInstalledVersionMarkers(layout)).toEqual({ currentVersionId: '1.0.0', previousVersionId: null });
            expect(await readdir(layout.versionsDir)).toEqual(['1.0.0']);
            expect(await readFile(join(layout.currentPath, binaryName), 'utf8')).toBe('original-version');
            expect(await readFile(join(layout.shimDir, binaryName), 'utf8')).toBe('original-version');
            expect(await readJsonReleaseChannel(resolveDefaultManagedReleaseChannelStatePath({ processEnv: env }))).toBe('stable');
        } finally {
            await rm(homeDir, { recursive: true, force: true });
        }
    });

    it('finishes promotion and finalization when cancellation arrives after installation starts', async () => {
        const homeDir = await mkdtemp(join(tmpdir(), 'happier-install-cancel-during-'));
        const env = { ...process.env, HAPPIER_HOME_DIR: homeDir };
        const layout = resolveFirstPartyInstallLayout({ componentId: 'happier-cli', channel: 'preview', processEnv: env });
        const executableSuffix = process.platform === 'win32' ? '.exe' : '';
        const binaryName = `happier${executableSuffix}`;
        try {
            await installVersionedPayload({
                componentId: 'happier-cli', versionId: '1.0.0', processEnv: env,
                payloadRoot: await createPayload(homeDir, '1.0.0', 'stable-version', binaryName),
            });
            const controller = new AbortController();
            const phases: string[] = [];
            await installVersionedPayload({
                componentId: 'happier-cli', versionId: '2.0.0-preview.1', channel: 'preview', processEnv: env,
                payloadRoot: await createPayload(homeDir, '2.0.0-preview.1', 'preview-version', binaryName),
                signal: controller.signal,
                onProgress: ({ phase }) => {
                    phases.push(phase);
                    if (phase === 'installing') controller.abort();
                },
            });
            expect(controller.signal.aborted).toBe(true);
            expect(phases).toEqual(['installing', 'finalizing']);
            expect(await readInstalledVersionMarkers(layout)).toEqual({ currentVersionId: '2.0.0-preview.1', previousVersionId: null });
            expect(await readFile(join(layout.currentPath, binaryName), 'utf8')).toBe('preview-version');
            expect(await readFile(join(layout.shimDir, `hprev${executableSuffix}`), 'utf8')).toBe('preview-version');
            // The installed stable CLI stays the default command (R10 D2).
            expect(await readFile(join(layout.shimDir, binaryName), 'utf8')).toBe('stable-version');
            expect(await readJsonReleaseChannel(resolveDefaultManagedReleaseChannelStatePath({ processEnv: env }))).toBe('stable');
        } finally {
            await rm(homeDir, { recursive: true, force: true });
        }
    });

    it('keeps the installed default channel when another channel is installed or self-updated, and sets it on first install or explicit selection', async () => {
        const homeDir = await mkdtemp(join(tmpdir(), 'happier-install-versioned-payload-channel-'));
        const env = { ...process.env, HAPPIER_HOME_DIR: homeDir };
        const statePath = resolveDefaultManagedReleaseChannelStatePath({ processEnv: env });
        const binaryName = process.platform === 'win32' ? 'happier.exe' : 'happier';
        const defaultShimPath = join(homeDir, 'bin', binaryName);

        try {
            // First install on an empty machine: stable becomes the default.
            await installVersionedPayload({
                componentId: 'happier-cli', versionId: '1.0.0', processEnv: env,
                payloadRoot: await createPayload(homeDir, '1.0.0', 'stable-version', binaryName),
            });
            expect(await readJsonReleaseChannel(statePath)).toBe('stable');

            // `happier-preview self update` (or a preview app acquiring its CLI) never repoints `happier`.
            for (const versionId of ['2.0.0-preview.1', '2.0.0-preview.2']) {
                await installVersionedPayload({
                    componentId: 'happier-cli', versionId, channel: 'preview', processEnv: env,
                    payloadRoot: await createPayload(homeDir, versionId, `preview-${versionId}`, binaryName),
                });
                expect(await readJsonReleaseChannel(statePath)).toBe('stable');
                expect(await readFile(defaultShimPath, 'utf8')).toBe('stable-version');
            }

            // The installer's explicit channel choice still selects the default.
            await installVersionedPayload({
                componentId: 'happier-cli', versionId: '2.0.0-preview.3', channel: 'preview', processEnv: env,
                payloadRoot: await createPayload(homeDir, '2.0.0-preview.3', 'preview-selected', binaryName),
                selectAsDefaultReleaseChannel: true,
            });
            expect(await readJsonReleaseChannel(statePath)).toBe('preview');
            expect(await readFile(defaultShimPath, 'utf8')).toBe('preview-selected');
        } finally {
            await rm(homeDir, { recursive: true, force: true });
        }
    });

    it('does not advance the persisted default release channel when shim sync fails', async () => {
        const homeDir = await mkdtemp(join(tmpdir(), 'happier-install-versioned-payload-channel-failure-'));
        const env = { ...process.env, HAPPIER_HOME_DIR: homeDir };
        const statePath = resolveDefaultManagedReleaseChannelStatePath({ processEnv: env });

        try {
            await installVersionedPayload({
                componentId: 'happier-cli',
                versionId: '1.0.0',
                payloadRoot: await createPayload(homeDir, '1.0.0', 'stable-version'),
                processEnv: env,
            });
            expect(await readJsonReleaseChannel(statePath)).toBe('stable');

            await rm(join(homeDir, 'bin'), { recursive: true, force: true });
            await writeFile(join(homeDir, 'bin'), 'not-a-directory', 'utf8');

            await expect(installVersionedPayload({
                componentId: 'happier-cli',
                versionId: '2.0.0-preview.1',
                payloadRoot: await createPayload(homeDir, '2.0.0-preview.1', 'preview-version'),
                processEnv: env,
                channel: 'preview',
                selectAsDefaultReleaseChannel: true,
            })).rejects.toThrow();

            expect(await readJsonReleaseChannel(statePath)).toBe('stable');
        } finally {
            await rm(homeDir, { recursive: true, force: true });
        }
    });

    it('updates the persisted default release channel only for default-channel-managed components', async () => {
        const homeDir = await mkdtemp(join(tmpdir(), 'happier-install-versioned-payload-channel-non-cli-'));
        const env = { ...process.env, HAPPIER_HOME_DIR: homeDir };
        const statePath = resolveDefaultManagedReleaseChannelStatePath({ processEnv: env });

        try {
            await installVersionedPayload({
                componentId: 'happier-cli',
                versionId: '1.0.0',
                payloadRoot: await createPayload(homeDir, '1.0.0', 'stable-version'),
                processEnv: env,
            });
            expect(await readJsonReleaseChannel(statePath)).toBe('stable');

            await installVersionedPayload({
                componentId: 'happier-server',
                versionId: '2.0.0-preview.1',
                payloadRoot: await createPayload(homeDir, '2.0.0-preview.1', 'preview-server'),
                processEnv: env,
                channel: 'preview',
            });
            expect(await readJsonReleaseChannel(statePath)).toBe('stable');

            await installVersionedPayload({
                componentId: 'happier-daemon',
                versionId: '2.5.0-preview.1',
                payloadRoot: await createPayload(homeDir, '2.5.0-preview.1', 'preview-daemon'),
                processEnv: env,
                channel: 'preview',
                selectAsDefaultReleaseChannel: true,
            });
            expect(await readJsonReleaseChannel(statePath)).toBe('preview');

            await installVersionedPayload({
                componentId: 'hstack',
                versionId: '3.0.0',
                payloadRoot: await createPayload(homeDir, '3.0.0', 'stable-stack'),
                processEnv: env,
                channel: 'stable',
            });
            expect(await readJsonReleaseChannel(statePath)).toBe('preview');
        } finally {
            await rm(homeDir, { recursive: true, force: true });
        }
    });
});
