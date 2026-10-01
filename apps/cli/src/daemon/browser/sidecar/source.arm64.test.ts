import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configurationState = vi.hoisted(() => ({ happyHomeDir: '' }));
const downloadMock = vi.hoisted(() => vi.fn());
vi.mock('@happier-dev/cli-common/agents', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/cli-common/agents')>();
    return { ...actual, downloadGitHubReleaseAsset: downloadMock };
});
// Environment is the boundary; installed-artifact validation stays real.
vi.mock('@/configuration', () => ({ configuration: {
    get happyHomeDir() { return configurationState.happyHomeDir; },
    get logsDir() { return join(configurationState.happyHomeDir, 'logs'); },
} }));
import { resolveManagedBrowserSidecarCandidate } from './source';
import { installChromiumForTesting, resolveInstalledChromiumForTestingExecutable } from '@/packagedRuntime/installables/sourceAdapters/chromiumForTesting';

beforeEach(async () => { configurationState.happyHomeDir = await mkdtemp(join(tmpdir(), 'happier-sidecar-source-')); });
afterEach(async () => { await rm(configurationState.happyHomeDir, { recursive: true, force: true }); });

async function installFixture(version: string): Promise<string> {
    const current = join(configurationState.happyHomeDir, 'tools/browser-chromium/current');
    const executable = join(current, 'chrome-linux-arm64/chrome');
    const bytes = '#!/bin/sh\necho fixture';
    await mkdir(dirname(executable), { recursive: true });
    await writeFile(executable, bytes);
    await chmod(executable, 0o755);
    await writeFile(join(current, '.happier-managed-version'), version);
    await writeFile(join(current, '.happier-managed-executable-sha256'), `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    return executable;
}

describe('managed Linux ARM64 browser source', () => {
    it('installs the asset version and resolves its real extracted executable', async () => {
        downloadMock.mockImplementation(async (params: { destinationPath: string; url: string; digest: string }) => {
            expect(params.url).toBe('https://storage.googleapis.com/chrome-for-testing-public/154.0.8037.92/linux-arm64/chrome-linux-arm64.zip');
            expect(params.digest).toBe('sha256:c0af361aab66b24c72e36a4326dce4d7edf4bc23f9aede8af988c2cb6ea3fec0');
            // Network fixture is a valid ZIP; extraction and promotion are not mocked.
            await writeFile(params.destinationPath, executableZip());
        });
        const result = await installChromiumForTesting({ platform: 'linux', arch: 'arm64' });
        expect(result).toMatchObject({ ok: true, pinnedVersion: '154.0.8037.92' });
        if (!result.ok) return;
        expect(await resolveInstalledChromiumForTestingExecutable({ platform: 'linux', arch: 'arm64' })).toBe(result.executablePath);
        expect(await resolveManagedBrowserSidecarCandidate({ platform: 'linux', arch: 'arm64' })).toMatchObject({
            available: true, executablePath: result.executablePath, provenance: { pinnedVersion: '154.0.8037.92' },
        });
    });
    it('resolves the installed platform version and provenance, rejecting a different installed version', async () => {
        const executablePath = await installFixture('154.0.8037.92');
        expect(await resolveManagedBrowserSidecarCandidate({ platform: 'linux', arch: 'arm64' })).toMatchObject({
            available: true, executablePath,
            provenance: { pinnedVersion: '154.0.8037.92', integrityDigest: 'sha256:c0af361aab66b24c72e36a4326dce4d7edf4bc23f9aede8af988c2cb6ea3fec0' },
        });
        await installFixture('127.0.6533.88');
        expect(await resolveManagedBrowserSidecarCandidate({ platform: 'linux', arch: 'arm64' })).toMatchObject({ available: false });
    });
});

// Stored ZIP fixture mirrors release-runtime's archiveExtraction tests.
function executableZip(): Buffer {
    const name = Buffer.from('chrome-linux-arm64/chrome');
    const bytes = Buffer.from('#!/bin/sh\necho fixture');
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const checksum = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(local.length + name.length + bytes.length, 16);
    return Buffer.concat([local, name, bytes, central, name, end]);
}
