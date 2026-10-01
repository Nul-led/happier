import { describe, expect, it } from 'vitest';
import { importAuthoringMemoryRowAbsent, importLegacyAuthoringMemorySetting } from './authoringMemoryImport.js';

describe('authoring memory destination-first import', () => {
  it('preserves an existing tombstone and observes the CAS winner after a competing creation', async () => {
    const tombstone = { status: 'deleted', revision: 2 } as const;
    const deleted = await importAuthoringMemoryRowAbsent({
      key: 'lastUsedProfile', value: 'legacy',
      read: async () => tombstone,
      seal: (_key, value) => ({ t: 'plain', v: value }),
      mutate: async () => { throw new Error('Existing tombstone must not be overwritten'); },
    });
    expect(deleted).toEqual(tombstone);
    let reads = 0;
    const winner = { status: 'present', revision: 1, content: { t: 'plain', v: 'other-device' } } as const;
    const created = await importAuthoringMemoryRowAbsent({
      key: 'lastUsedProfile', value: 'legacy',
      read: async () => ++reads === 1 ? { status: 'absent' } : winner,
      seal: (_key, value) => ({ t: 'plain', v: value }),
      mutate: async () => ({ status: 'conflict', revision: 1 }),
    });
    expect(created).toEqual(winner);
  });

  it('reconciles an interrupted exact-CAS removal without overwriting committed memory or unrelated keys', async () => {
    let raw: Record<string, unknown> = { lastUsedProfile: 'legacy', keep: true };
    let version = 1;
    let destination: unknown;
    let attempts = 0;
    await importLegacyAuthoringMemorySetting({
      key: 'lastUsedProfile', assertCurrent: () => {},
      read: async () => ({ raw: { ...raw }, version }),
      transfer: async (value) => { destination ??= value; },
      remove: async (_key, expectedVersion) => {
        expect(expectedVersion).toBe(version);
        if (++attempts === 1) { raw.lastUsedProfile = 'new-legacy'; version += 1; return 'conflict'; }
        delete raw.lastUsedProfile;
        return 'applied';
      },
    });
    expect(destination).toBe('legacy');
    expect(raw).toEqual({ keep: true });
  });
});
