import { describe, expect, it } from 'vitest';

import { preparePersonalHomeRestorePromotionSources } from './restorePromotion.js';

describe('Personal Home restore promotion preparation', () => {
  it('cleans an interrupted cross-filesystem candidate without touching the active target', async () => {
    const target = '/destination/home.sqlite';
    const source = '/staging/database/home.sqlite';
    const existing = new Map<string, string>([[target, 'old-active'], [source, 'new-backup']]);
    const events: string[] = [];

    await expect(preparePersonalHomeRestorePromotionSources({
      entries: [{ target, source }],
      operationId: '00000000-0000-4000-8000-000000000001',
      stageDeviceId: 'stage-device',
      readFilesystemCapacity: async () => ({ deviceId: 'destination-device', availableBytes: 1024 }),
      beforeMaterialize: async (entries) => {
        events.push(`journal:${entries[0]?.source}`);
        expect(existing.get(target)).toBe('old-active');
      },
      filesystem: {
        exists: async (path) => existing.has(path),
        mkdir: async () => undefined,
        copy: async (_from, to) => {
          events.push(`copy:${to}`);
          existing.set(to, 'partial-new-backup');
          throw new Error('simulated interrupted copy');
        },
        remove: async (path) => { existing.delete(path); },
        syncTree: async () => undefined,
      },
    })).rejects.toThrow('simulated interrupted copy');

    expect(existing.get(target)).toBe('old-active');
    expect(existing.has(`${target}.restore-candidate-00000000-0000-4000-8000-000000000001`)).toBe(false);
    expect(events).toEqual([
      `journal:${target}.restore-candidate-00000000-0000-4000-8000-000000000001`,
      `copy:${target}.restore-candidate-00000000-0000-4000-8000-000000000001`,
    ]);
  });

  it('uses the original staged source on the destination filesystem and a synced sibling candidate across filesystems', async () => {
    const copied: Array<readonly [string, string]> = [];
    const synced: string[] = [];
    const source = '/staging/files/public';
    const target = '/destination/files/public';

    const prepared = await preparePersonalHomeRestorePromotionSources({
      entries: [
        { source: '/staging/database/home.sqlite', target: '/staging-live/home.sqlite' },
        { source, target },
      ],
      operationId: '00000000-0000-4000-8000-000000000002',
      stageDeviceId: 'stage-device',
      readFilesystemCapacity: async (path) => ({
        deviceId: path.startsWith('/staging-live') ? 'stage-device' : 'destination-device',
        availableBytes: 1024,
      }),
      filesystem: {
        exists: async () => true,
        mkdir: async () => undefined,
        copy: async (from, to) => { copied.push([from, to]); },
        remove: async () => undefined,
        syncTree: async (path) => { synced.push(path); },
      },
    });

    expect(prepared.entries[0]?.source).toBe('/staging/database/home.sqlite');
    expect(prepared.entries[1]?.source).toBe(`${target}.restore-candidate-00000000-0000-4000-8000-000000000002`);
    expect(copied).toEqual([[source, prepared.entries[1]?.source]]);
    expect(synced).toEqual(['/staging/database/home.sqlite', prepared.entries[1]?.source]);
  });
});
