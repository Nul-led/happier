import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinnedArchiveRuntimeInstallableAdapter } from './pinnedArchive';
import { cancellationSources, createCancellationFixture } from './installCancellation.testkit';

const { configurationState } = vi.hoisted(() => ({ configurationState: { happyHomeDir: '' } }));
vi.mock('@/configuration', () => ({ configuration: configurationState }));

// Flat official-archive topology, with a tiny server executable and companion.
const archive = Buffer.from(
  'UEsDBBQAAAAAAKCqIl2/ze6ZDgAAAA4AAAASAAAAYWd5X2FjcF9zZXJ2ZXIucGFyc2VydmVyLWZpeHR1cmVQSwMEFAAAAAAAoKoiXeOBVF8PAAAADwAAABUAAABsb2NhbGhhcm5lc3NfZXh0ZXJuYWxoYXJuZXNzLWZpeHR1cmVQSwECFAMUAAAAAACgqiJdv83umQ4AAAAOAAAAEgAAAAAAAAAAAAAA7YEAAAAAYWd5X2FjcF9zZXJ2ZXIucGFyUEsBAhQDFAAAAAAAoKoiXeOBVF8PAAAADwAAABUAAAAAAAAAAAAAAO2BPgAAAGxvY2FsaGFybmVzc19leHRlcm5hbFBLBQYAAAAAAgACAIMAAACAAAAAAAA=',
  'base64',
);
const homes: string[] = [];
const servers: Server[] = [];

async function createFixture(slow = false) {
  const home = await mkdtemp(join(tmpdir(), 'happier-pinned-progress-'));
  homes.push(home);
  configurationState.happyHomeDir = home;
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-length': archive.length });
    if (slow) response.write(archive.subarray(0, 8));
    else response.end(archive);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture has no port');
  const asset = {
    archiveUrl: `http://127.0.0.1:${address.port}/server.zip`,
    sha256: createHash('sha256').update(archive).digest('hex'),
    executableSubpath: 'agy_acp_server.par',
  };
  const adapter = createPinnedArchiveRuntimeInstallableAdapter({
    installId: 'dep.antigravity.agy-acp-server',
    version: '1.1.1',
    asset,
  });
  return { home, adapter, asset };
}

afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  servers.length = 0;
  await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
  homes.length = 0;
  vi.resetModules();
});

describe('pinned archive acquisition progress and cancellation', () => {
  it.each(cancellationSources)('preserves a pre-aborted signal reason for $kind', async (source) => {
    const home = await mkdtemp(join(tmpdir(), 'happier-install-cancel-'));
    homes.push(home);
    configurationState.happyHomeDir = home;
    const { descriptor, adapter } = await createCancellationFixture(source);
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.installOrUpgrade({ env: { HAPPIER_HOME_DIR: home }, signal: controller.signal })).rejects.toBe(controller.signal.reason);
    await expect(stat(join(home, 'tools', descriptor.key, 'current'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports actual downloaded bytes and publishes the verified archive', async () => {
    const { home, adapter } = await createFixture();
    const events: Array<{ t: string; bytesDone?: number; bytesTotal?: number | null }> = [];
    await expect(adapter.installOrUpgrade({ onProgress: (event) => events.push(event) })).resolves.toEqual({ ok: true, logPath: null });
    expect(events).toContainEqual({ t: 'progress', bytesDone: archive.length, bytesTotal: archive.length });
    await expect(readFile(join(home, 'tools', adapter.key, 'current', 'agy_acp_server.par'), 'utf8')).resolves.toBe('server-fixture');
    expect(await readdir(join(home, 'tools', adapter.key, '.tmp'))).toEqual([]);
  });

  it('installs and resolves from an explicitly selected environment home', async () => {
    const { home, adapter } = await createFixture();
    const selectedHome = await mkdtemp(join(tmpdir(), 'happier-pinned-selected-'));
    homes.push(selectedHome);
    const env = { HAPPIER_HOME_DIR: selectedHome };
    await expect(adapter.installOrUpgrade({ env })).resolves.toEqual({ ok: true, logPath: null });
    await expect(readFile(join(selectedHome, 'tools', adapter.key, 'current', 'agy_acp_server.par'), 'utf8')).resolves.toBe('server-fixture');
    await expect(adapter.resolveLaunchCommand?.({ env })).resolves.toMatchObject({ ok: true, command: join(selectedHome, 'tools', adapter.key, 'current', 'agy_acp_server.par') });
    await expect(adapter.detectLaunchResolution({ env })).resolves.toMatchObject({ availability: { ok: true } });
    await expect(stat(join(home, 'tools'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('aborts an active download and removes its partial candidate', async () => {
    const { home, adapter } = await createFixture(true);
    const controller = new AbortController();
    const reason = new Error('cancelled');
    const installation = adapter.installOrUpgrade({
      signal: controller.signal,
      onProgress: (event) => {
        if (event.t === 'progress' && event.bytesDone > 0) controller.abort(reason);
      },
    });
    await expect(installation).rejects.toBe(reason);
    expect(controller.signal.aborted).toBe(true);
    expect(await readdir(join(home, 'tools', adapter.key, '.tmp'))).toEqual([]);
    await expect(stat(join(home, 'tools', adapter.key, 'current'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports the canonical extraction timeout code and removes its candidate', async () => {
    const { home, asset } = await createFixture();
    const adapter = createPinnedArchiveRuntimeInstallableAdapter({
      installId: 'dep.antigravity.agy-acp-server',
      version: '1.1.1',
      asset,
      archiveExtractionLimits: { timeoutMs: 0 },
    });
    await expect(adapter.installOrUpgrade()).resolves.toMatchObject({ ok: false, errorCode: 'command-timed-out' });
    expect(await readdir(join(home, 'tools', adapter.key, '.tmp'))).toEqual([]);
    await expect(stat(join(home, 'tools', adapter.key, 'current'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the previous installed version when verification is cancelled', async () => {
    const { home, adapter, asset } = await createFixture();
    await expect(adapter.installOrUpgrade()).resolves.toMatchObject({ ok: true });
    const next = createPinnedArchiveRuntimeInstallableAdapter({ installId: 'dep.antigravity.agy-acp-server', version: '1.1.2', asset });
    const controller = new AbortController();
    const reason = new Error('cancelled');
    await expect(next.installOrUpgrade({
      signal: controller.signal,
      onProgress: (event) => {
        if (event.t === 'log' && event.line === 'Verifying executable') controller.abort(reason);
      },
    })).rejects.toBe(reason);
    await expect(readFile(join(home, 'tools', adapter.key, 'current', '.happier-managed-version'), 'utf8')).resolves.toBe('1.1.1');
    expect(await readdir(join(home, 'tools', adapter.key, '.tmp'))).toEqual([]);
  });
});
