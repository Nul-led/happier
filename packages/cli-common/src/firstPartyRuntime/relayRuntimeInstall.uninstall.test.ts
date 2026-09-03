import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { uninstallRelayRuntimePayloadLocal } from './relayRuntimeInstall.js';

describe('uninstallRelayRuntimePayloadLocal', () => {
  it('removes runtime payload and logs while preserving persistent config and data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-relay-uninstall-'));
    const installRoot = join(root, 'self-host');
    const shimPath = join(root, 'bin', 'happier-server');
    const statePath = join(installRoot, 'self-host-state.json');
    const logDir = join(installRoot, 'logs');
    await mkdir(join(installRoot, 'bin'), { recursive: true });
    await mkdir(join(installRoot, 'ui-web'), { recursive: true });
    await mkdir(join(installRoot, 'config'), { recursive: true });
    await mkdir(join(installRoot, 'data'), { recursive: true });
    await mkdir(join(installRoot, 'operator-backups'), { recursive: true });
    await mkdir(logDir, { recursive: true });
    await mkdir(join(root, 'bin'), { recursive: true });
    await writeFile(join(installRoot, 'bin', 'happier-server'), 'runtime');
    await writeFile(join(installRoot, 'ui-web', 'index.html'), 'runtime');
    await writeFile(join(installRoot, 'config', 'server.env'), 'PORT=3005\n');
    await writeFile(join(installRoot, 'data', 'home.sqlite'), 'home');
    await writeFile(join(installRoot, 'operator-note.txt'), 'keep me');
    await writeFile(join(installRoot, 'operator-backups', 'snapshot.tar'), 'keep this too');
    await writeFile(join(installRoot, 'logs', 'server.log'), 'log');
    await writeFile(statePath, '{}');
    await writeFile(shimPath, 'shim');

    await uninstallRelayRuntimePayloadLocal({ installRoot, shimPath, statePath, logDir });

    await expect(access(join(installRoot, 'bin'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(installRoot, 'ui-web'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(shimPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(statePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(logDir)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(installRoot, 'config', 'server.env'), 'utf8')).resolves.toBe('PORT=3005\n');
    await expect(readFile(join(installRoot, 'data', 'home.sqlite'), 'utf8')).resolves.toBe('home');
    await expect(readFile(join(installRoot, 'operator-note.txt'), 'utf8')).resolves.toBe('keep me');
    await expect(readFile(join(installRoot, 'operator-backups', 'snapshot.tar'), 'utf8')).resolves.toBe('keep this too');
  });

  it('retains the Personal Home purpose and version needed to reinstall preserved data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-home-uninstall-state-'));
    const installRoot = join(root, 'self-host');
    const statePath = join(installRoot, 'self-host-state.json');
    const logDir = join(installRoot, 'logs');
    const shimPath = join(root, 'bin', 'happier-server');
    await mkdir(join(installRoot, 'bin'), { recursive: true });
    await mkdir(logDir, { recursive: true });
    await mkdir(join(root, 'bin'), { recursive: true });
    await writeFile(join(installRoot, 'bin', 'happier-server'), 'runtime');
    await writeFile(shimPath, 'shim');

    await uninstallRelayRuntimePayloadLocal({
      installRoot,
      shimPath,
      statePath,
      logDir,
      retainedPurpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
      retainedVersion: '0.3.0-test',
    });

    await expect(readFile(statePath, 'utf8').then((text) => JSON.parse(text))).resolves.toEqual({
      retainedPersonalHomeVersion: '0.3.0-test',
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:43123' },
    });
  });
});
