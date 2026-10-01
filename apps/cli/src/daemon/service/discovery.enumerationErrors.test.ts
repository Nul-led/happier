import { describe, expect, it, vi } from 'vitest';
const { readdirSyncMock } = vi.hoisted(() => ({ readdirSyncMock: vi.fn() }));
// Directory enumeration is an OS boundary; retain real definition parsing.
vi.mock('node:fs', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs')>(), readdirSync: readdirSyncMock }));
import { discoverInstalledDaemonServiceEntries } from './discoverInstalledDaemonServiceEntries';
describe('daemon service inventory enumeration', () => {
  it('treats only missing directories as empty and propagates unreadable inventory', async () => {
    const params = { platform: 'linux', mode: 'user', userHomeDir: '/test', happierHomeDir: '/test/.happier', serversById: {} } as const;
    for (const code of ['EACCES', 'EIO']) {
      const error = Object.assign(new Error(code), { code });
      readdirSyncMock.mockImplementation(() => { throw error; });
      await expect(discoverInstalledDaemonServiceEntries(params)).rejects.toBe(error);
    }
    readdirSyncMock.mockImplementation(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
    await expect(discoverInstalledDaemonServiceEntries(params)).resolves.toEqual([]);
  });
});
