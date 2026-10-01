import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { configurationState, downloadMock } = vi.hoisted(() => ({
  configurationState: { happyHomeDir: '' },
  downloadMock: vi.fn(),
}));

vi.mock('@/configuration', () => ({
  configuration: {
    get happyHomeDir() {
      return configurationState.happyHomeDir;
    },
    get logsDir() {
      return `${configurationState.happyHomeDir}/logs`;
    },
  },
}));

vi.mock('@happier-dev/cli-common/agents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@happier-dev/cli-common/agents')>();
  return { ...actual, downloadGitHubReleaseAsset: downloadMock };
});

const tempDirs = new Set<string>();
const flatArchive = Buffer.from(
  'UEsDBBQAAAAAAKCqIl2/ze6ZDgAAAA4AAAASAAAAYWd5X2FjcF9zZXJ2ZXIucGFyc2VydmVyLWZpeHR1cmVQSwMEFAAAAAAAoKoiXeOBVF8PAAAADwAAABUAAABsb2NhbGhhcm5lc3NfZXh0ZXJuYWxoYXJuZXNzLWZpeHR1cmVQSwECFAMUAAAAAACgqiJdv83umQ4AAAAOAAAAEgAAAAAAAAAAAAAA7YEAAAAAYWd5X2FjcF9zZXJ2ZXIucGFyUEsBAhQDFAAAAAAAoKoiXeOBVF8PAAAADwAAABUAAAAAAAAAAAAAAO2BPgAAAGxvY2FsaGFybmVzc19leHRlcm5hbFBLBQYAAAAAAgACAIMAAACAAAAAAAA=',
  'base64',
);

afterEach(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  tempDirs.clear();
  vi.clearAllMocks();
  vi.resetModules();
});

describe('pinned archive flat payload installation', () => {
  it('keeps the server and companion together while staging on the managed-install filesystem', async () => {
    const home = await mkdtemp(join(tmpdir(), 'happier-pinned-flat-'));
    tempDirs.add(home);
    configurationState.happyHomeDir = home;
    downloadMock.mockImplementation(async ({ destinationPath }: { destinationPath: string }) => {
      expect(destinationPath.startsWith(`${home}${sep}`)).toBe(true);
      await writeFile(destinationPath, flatArchive);
    });

    const { installPinnedArchive } = await import('./pinnedArchive');
    const result = await installPinnedArchive({
      installId: 'dep.antigravity.agy-acp-server',
      version: '1.1.1',
      asset: {
        archiveUrl: 'https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_1.1.1-linux-x86_64.zip',
        sha256: '38f62d01b32deb0907b3d39a71ec301fd36369f6ffd1cf262d4af385177f79df',
        executableSubpath: 'agy_acp_server.par',
        args: ['--uid='],
      },
      archiveExtractionLimits: {
        maxArchiveBytes: 1024,
        maxFileBytes: 32,
        maxExpandedBytes: 64,
        timeoutMs: 10_000,
      },
      platform: 'linux',
    });

    expect(result).toMatchObject({ ok: true, version: '1.1.1' });
    const current = join(home, 'tools', 'dep.antigravity.agy-acp-server', 'current');
    await expect(readFile(join(current, 'agy_acp_server.par'), 'utf8')).resolves.toBe('server-fixture');
    await expect(readFile(join(current, 'localharness_external'), 'utf8')).resolves.toBe('harness-fixture');
  });
});
