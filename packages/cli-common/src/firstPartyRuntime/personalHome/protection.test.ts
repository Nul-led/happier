import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createPersonalHomePathProtection } from './protection.js';

describe('Personal Home authority-bearing path protection', () => {
  it('delegates Windows ownership and ACL verification to the canonical Windows boundary', async () => {
    const applyAndVerify = vi.fn(async () => undefined);
    const protect = createPersonalHomePathProtection({
      platform: 'win32',
      windowsAcl: { applyAndVerify, verify: async () => undefined },
    });
    await protect('/personal-home/backup.tar', 'file');
    expect(applyAndVerify).toHaveBeenCalledWith({ path: '/personal-home/backup.tar', kind: 'file' });
  });

  it('applies restrictive POSIX modes without swallowing failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-home-protection-'));
    try {
      const directory = join(root, 'private');
      const file = join(directory, 'secret');
      await mkdir(directory);
      await writeFile(file, 'secret');
      const protect = createPersonalHomePathProtection({ platform: 'linux' });
      await protect(directory, 'directory');
      await protect(file, 'file');
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      await expect(protect(join(root, 'missing'), 'file')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
