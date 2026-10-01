import { describe, expect, it, vi } from 'vitest';
const { readdirMock } = vi.hoisted(() => ({ readdirMock: vi.fn() }));
// Directory enumeration is an OS boundary; preserve the discovery owner.
vi.mock('node:fs/promises', async (importOriginal) => ({ ...await importOriginal<typeof import('node:fs/promises')>(), readdir: readdirMock }));
import { listKnownServiceDefinitionFiles } from './listKnownServiceDefinitionFiles.js';
describe('service definition inventory enumeration', () => {
  it('treats only missing directories as empty and propagates unreadable inventory', async () => {
    const params = { roots: [{ path: '/test', scope: 'user' }] } as const;
    for (const code of ['EACCES', 'EIO']) {
      const error = Object.assign(new Error(code), { code });
      readdirMock.mockRejectedValue(error);
      await expect(listKnownServiceDefinitionFiles(params)).rejects.toBe(error);
    }
    readdirMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await expect(listKnownServiceDefinitionFiles(params)).resolves.toEqual([]);
  });
});
