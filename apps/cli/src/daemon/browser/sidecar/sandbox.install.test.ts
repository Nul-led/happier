import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { installManagedChromiumAppArmorProfile } from './sandbox';

const boundary = vi.hoisted(() => ({ code: 0, calls: [] as Array<{ command: string; args: string[] }> }));
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: (command: string, args: string[]) => {
    boundary.calls.push({ command, args });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', boundary.code, null));
    return child;
  },
}));
const originalPlatform = process.platform;
afterEach(() => { Object.defineProperty(process, 'platform', { value: originalPlatform }); boundary.calls = []; });

it('uses noninteractive OS authorization for daemon recovery while installing only the executable-scoped profile', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  const scratch = await mkdtemp(join(tmpdir(), 'sandbox-test-'));
  const executable = join(scratch, 'chrome');
  await writeFile(executable, 'fixture');
  try {
    boundary.code = 0;
    await installManagedChromiumAppArmorProfile(executable, { interactive: false });
    expect(boundary.calls[0]).toMatchObject({ command: 'sudo' });
    expect(boundary.calls[0]?.args.slice(0, 3)).toEqual(['-n', '--', '/bin/sh']);
    expect(boundary.calls[0]?.args.at(-1)).toMatch(/^\/etc\/apparmor\.d\/happier-managed-chromium-[a-f0-9]+$/u);
    boundary.code = 1;
    await expect(installManagedChromiumAppArmorProfile(executable, { interactive: false }))
      .rejects.toMatchObject({ code: 'os_authorization_required' });
    boundary.code = 42;
    await expect(installManagedChromiumAppArmorProfile(executable, { interactive: false }))
      .rejects.toMatchObject({ code: 'sandbox_install_failed' });
    const cancelled = new AbortController();
    cancelled.abort();
    const dispatched = boundary.calls.length;
    await expect(installManagedChromiumAppArmorProfile(executable, { interactive: false, signal: cancelled.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(boundary.calls).toHaveLength(dispatched);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
