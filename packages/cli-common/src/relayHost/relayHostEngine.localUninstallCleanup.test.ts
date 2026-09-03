import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRelayHostEngine } from './relayHostEngine.js';

const harness = vi.hoisted(() => ({
  fixtureRoot: '',
  homeDir: '',
  invoked: [] as string[],
  legacyRegistered: true,
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => harness.homeDir };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawnSync: (cmd: string, args?: readonly string[]) => {
      harness.invoked.push([cmd, ...(Array.isArray(args) ? args : [])].join(' '));
      if (cmd === 'systemctl' && args?.includes('show')) {
        return { status: 0, stdout: 'UnitFileState=\nActiveState=inactive\nSubState=dead\nLoadState=not-found\n', stderr: '' };
      }
      if (cmd === 'launchctl' && args?.[0] === 'list') {
        return { status: 113, stdout: '', stderr: 'Could not find service "happier-server" in domain for user gui: 501' };
      }
      if (cmd === 'powershell.exe') {
        const script = String(args?.at(-1) ?? '');
        if (script.includes('Unregister-ScheduledTask') && script.includes('$taskName = "happier-server"')) {
          harness.legacyRegistered = false;
          return { status: 0, stdout: '', stderr: '' };
        }
        if (script.includes('$taskName = "happier-server-preview"')) return { status: 0, stdout: '{"exists":false}', stderr: '' };
        if (script.includes('$taskName = "happier-server"')) {
          return {
            status: 0,
            stdout: harness.legacyRegistered
              ? '{"exists":true,"enabled":true,"active":true}'
              : '{"exists":false}',
            stderr: '',
          };
        }
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  };
});

vi.mock('../firstPartyRuntime/withFirstPartyPayloadMutationLock.js', () => ({
  withFirstPartyPayloadMutationLock: async (params: { operation: () => Promise<unknown> }) => await params.operation(),
}));

const originalPlatform = process.platform;
const originalGetuid = (process as unknown as { getuid?: (() => number) | undefined }).getuid;

function createEngine() {
  return createRelayHostEngine({
    resolveRemoteReleaseTarget: async () => ({ os: 'linux', arch: 'x64' }),
    runRemoteText: async () => ({ status: 0, stdout: '', stderr: '' }),
    copyLocalDirectoryToRemote: async () => {},
    installRemoteComponent: async () => ({ binaryPath: '$HOME/.happier/happier-server/current/happier-server', versionId: 'stable-1' }),
  });
}

async function pathExists(path: string): Promise<boolean> {
  return await stat(path).then(() => true).catch(() => false);
}

describe('RelayHostEngine (local uninstall cleanup)', () => {
  beforeEach(async () => {
    harness.fixtureRoot = await mkdtemp('/tmp/relay-host-uninstall-');
    harness.homeDir = join(harness.fixtureRoot, 'home');
    harness.invoked.length = 0;
    harness.legacyRegistered = true;
    await mkdir(harness.homeDir, { recursive: true });
    (process as unknown as { getuid?: (() => number) | undefined }).getuid = () => 501;
  });

  afterEach(async () => {
    await rm(harness.fixtureRoot, { recursive: true, force: true });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalGetuid) (process as unknown as { getuid?: (() => number) | undefined }).getuid = originalGetuid;
    else delete (process as unknown as { getuid?: (() => number) | undefined }).getuid;
  });

  it('preserves Personal Home data while removing only runtime-owned files', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const installRoot = join(harness.homeDir, '.happier', 'self-host');
    const dataDir = join(installRoot, 'data');
    const configDir = join(installRoot, 'config');
    const logDir = join(installRoot, 'logs');
    await mkdir(dataDir, { recursive: true });
    await mkdir(configDir, { recursive: true });
    await mkdir(logDir, { recursive: true });
    await writeFile(join(configDir, 'server.env'), 'PORT=43123\n');

    await createEngine().control({
      target: { kind: 'local' },
      mode: 'user',
      channel: 'stable',
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      action: 'uninstall',
    });

    await expect(readFile(join(configDir, 'server.env'), 'utf8')).resolves.toBe('PORT=43123\n');
    expect(await pathExists(dataDir)).toBe(true);
    expect(await pathExists(configDir)).toBe(true);
    expect(await pathExists(installRoot)).toBe(true);
    expect(await pathExists(logDir)).toBe(false);
  });

  it('does not recursively remove the install root after safe runtime cleanup', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const installRoot = join(harness.homeDir, '.happier', 'self-host-dev');
    const configDir = join(installRoot, 'config');
    const logDir = join(installRoot, 'logs');
    await mkdir(configDir, { recursive: true });
    await mkdir(logDir, { recursive: true });

    await createEngine().control({ target: { kind: 'local' }, mode: 'user', channel: 'dev', action: 'uninstall' });

    expect(await pathExists(installRoot)).toBe(true);
    expect(await pathExists(configDir)).toBe(true);
    expect(await pathExists(logDir)).toBe(false);
  });

  it('removes the self-host state file explicitly during uninstall', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const installRoot = join(harness.homeDir, '.happier', 'self-host-dev');
    const statePath = join(installRoot, 'self-host-state.json');
    await mkdir(installRoot, { recursive: true });
    await writeFile(statePath, '{}');

    await createEngine().control({ target: { kind: 'local' }, mode: 'user', channel: 'dev', action: 'uninstall' });

    expect(await pathExists(statePath)).toBe(false);
  });

  it('uninstalls the legacy unsuffixed scheduled task when the preview lane still owns that install root', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const installRoot = `${harness.homeDir}\\.happier\\self-host-preview`;
    const wrapperPath = `${harness.homeDir}\\.happier\\services\\happier-server.ps1`;
    await writeFile(wrapperPath, `$ErrorActionPreference = "Stop"\nSet-Location -LiteralPath "${installRoot}"\n`);

    await createEngine().control({ target: { kind: 'local' }, mode: 'user', channel: 'preview', action: 'uninstall' });

    expect(harness.invoked.some((cmd) => cmd.includes('powershell.exe')
      && cmd.includes('Stop-ScheduledTask')
      && cmd.includes('$taskName = "happier-server"')), harness.invoked.join('\n')).toBe(true);
    expect(harness.invoked.some((cmd) => cmd.includes('powershell.exe')
      && cmd.includes('Unregister-ScheduledTask')
      && cmd.includes('$taskName = "happier-server"'))).toBe(true);
  });
});
