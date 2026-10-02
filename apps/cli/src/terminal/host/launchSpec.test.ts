import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, expect, it, vi } from 'vitest';

import { createTerminalLaunchSpec } from './launchSpec';
import { logger } from '@/ui/logger';

describe('terminal native startup receipt', () => {
  it.each(['spawned', 'failed'] as const)('reports %s only from a real native executable outcome without an IPC parent', async (expected) => {
    const launch = await createTerminalLaunchSpec({
      workingDirectory: process.cwd(),
      spawnArgv: expected === 'spawned' ? [process.execPath, '-e', 'process.exit(0)'] : ['/missing/native-fixture'],
      spawnEnv: {}, envPassthroughKeys: [], reportNativeSpawn: true,
    });
    const receipt = join(dirname(launch.specPath), 'native-startup.json');
    try {
      expect(await readFile(receipt, 'utf8')).toBe(JSON.stringify({ status: 'pending' }));
      expect(launch.awaitNativeSpawnResult).toBeTypeOf('function');
      const execution = promisify(execFile)(launch.argv[0]!, [...launch.argv.slice(1)]);
      if (expected === 'spawned') await execution;
      else await expect(execution).rejects.toMatchObject({ code: 127 });
      await expect(launch.awaitNativeSpawnResult!(Date.now() + 10_000, 25)).resolves.toBe(expected);
      await expect(stat(launch.specPath)).rejects.toMatchObject({ code: 'ENOENT' });
      // Windows reports only its limited chmod mode bits; POSIX private permissions
      // are asserted here, while native Windows ACL behavior needs its platform gate.
      if (process.platform !== 'win32') expect((await stat(receipt)).mode & 0o777).toBe(0o600);
      await launch.discard();
      await launch.discard();
      await expect(stat(dirname(launch.specPath))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await launch.discard(); }
  });

  it('cancels a pending receipt wait without removing evidence or inventing a native outcome', async () => {
    const launch = await createTerminalLaunchSpec({ workingDirectory: process.cwd(),
      spawnArgv: [process.execPath], spawnEnv: {}, envPassthroughKeys: [], reportNativeSpawn: true });
    const cancellation = new AbortController();
    try {
      const waiting = launch.awaitNativeSpawnResult!(Date.now() + 60_000, 50, cancellation.signal);
      cancellation.abort();
      await expect(waiting).resolves.toBe('unknown');
      expect(JSON.parse(await readFile(join(dirname(launch.specPath), 'native-startup.json'), 'utf8'))).toEqual({ status: 'pending' });
    } finally { await launch.discard(); }
  });

  it('keeps missing evidence pending until proof arrives or the containing deadline expires', async () => {
    const launch = await createTerminalLaunchSpec({ workingDirectory: process.cwd(),
      spawnArgv: [process.execPath], spawnEnv: {}, envPassthroughKeys: [], reportNativeSpawn: true });
    const receipt = join(dirname(launch.specPath), 'native-startup.json');
    try {
      await unlink(receipt);
      let settled = false;
      const waiting = launch.awaitNativeSpawnResult!(Date.now() + 10_000, 5).then((result) => { settled = true; return result; });
      await delay(25);
      expect(settled).toBe(false);
      await writeFile(receipt, JSON.stringify({ status: 'spawned' }));
      await expect(waiting).resolves.toBe('spawned');
      await writeFile(receipt, JSON.stringify({ status: 'pending' }));
      await expect(launch.awaitNativeSpawnResult!(Date.now(), 5)).resolves.toBe('unknown');
      expect(JSON.parse(await readFile(receipt, 'utf8'))).toEqual({ status: 'pending' });
      await expect(stat(launch.specPath)).resolves.toBeDefined();
    } finally { await launch.discard(); }
  });

  it('attempts receipt cleanup after a failed launch-file removal and surfaces all real filesystem failures', async () => {
    const launch = await createTerminalLaunchSpec({ workingDirectory: process.cwd(),
      spawnArgv: [process.execPath], spawnEnv: {}, envPassthroughKeys: [], reportNativeSpawn: true });
    const receipt = join(dirname(launch.specPath), 'native-startup.json');
    const diagnostic = vi.spyOn(logger, 'infoFile').mockImplementation(() => undefined);
    try {
      await unlink(launch.specPath);
      await mkdir(launch.specPath);
      await expect(launch.discard()).rejects.toBeInstanceOf(AggregateError);
      await expect(stat(receipt)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(JSON.stringify(diagnostic.mock.calls)).toContain('terminal_launch_cleanup_incomplete');
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(launch.specPath);
    } finally {
      diagnostic.mockRestore();
      await rm(launch.specPath, { recursive: true, force: true });
      await launch.discard();
    }
  });

  it('fails closed on malformed or unreadable receipt evidence with a sanitized file diagnostic', async () => {
    const launch = await createTerminalLaunchSpec({ workingDirectory: process.cwd(),
      spawnArgv: [process.execPath], spawnEnv: {}, envPassthroughKeys: [], reportNativeSpawn: true });
    const receipt = join(dirname(launch.specPath), 'native-startup.json');
    const diagnostic = vi.spyOn(logger, 'infoFile').mockImplementation(() => undefined);
    try {
      await writeFile(receipt, 'synthetic-private-invalid-receipt');
      await expect(launch.awaitNativeSpawnResult!(Date.now() + 10_000, 25)).resolves.toBe('unknown');
      await unlink(receipt);
      await mkdir(receipt);
      await expect(launch.awaitNativeSpawnResult!(Date.now() + 10_000, 25)).resolves.toBe('unknown');
      const diagnostics = JSON.stringify(diagnostic.mock.calls);
      expect(diagnostics).toContain('terminal_native_startup_unknown');
      expect(diagnostics).not.toContain('synthetic-private');
      expect(diagnostics).not.toContain(receipt);
    } finally {
      diagnostic.mockRestore();
      await rm(receipt, { recursive: true, force: true });
      await launch.discard();
    }
  });
});
