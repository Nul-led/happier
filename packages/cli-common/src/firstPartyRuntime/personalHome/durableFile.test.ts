import { describe, expect, it, vi } from 'vitest';

const events: string[] = [];
let openError: NodeJS.ErrnoException | null = null;

vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(async () => ({ isDirectory: () => false, isSymbolicLink: () => false })),
  open: vi.fn(async (path: string) => {
    if (openError && path === '/state') throw openError;
    return ({
    sync: async () => { events.push(`sync:${path}`); },
    close: async () => { events.push(`close:${path}`); },
  });
  }),
  rename: vi.fn(async (from: string, to: string) => { events.push(`rename:${from}->${to}`); }),
  rm: vi.fn(async (path: string) => { events.push(`rm:${path}`); }),
}));

import { removePathDurably, renamePersonalHomePathDurably, replacePersonalHomeFileDurably } from './durableFile.js';

describe('Personal Home durable file replacement', () => {
  it('syncs replacement bytes before rename and parent metadata after rename', async () => {
    events.length = 0;
    openError = null;

    await replacePersonalHomeFileDurably('/state/home.json.tmp', '/state/home.json');

    expect(events).toEqual([
      'sync:/state/home.json.tmp',
      'close:/state/home.json.tmp',
      'rename:/state/home.json.tmp->/state/home.json',
      'sync:/state',
      'close:/state',
    ]);
  });

  it('fails when a POSIX parent directory cannot be synchronized', async () => {
    events.length = 0;
    openError = Object.assign(new Error('permission denied'), { code: 'EACCES' });

    await expect(replacePersonalHomeFileDurably('/state/home.json.tmp', '/state/home.json'))
      .rejects.toMatchObject({ code: 'EACCES' });
  });

  it('does not let a restore journal follow a path move before both parent directories are synced', async () => {
    events.length = 0;

    await renamePersonalHomePathDurably('/stage/home.sqlite', '/active/home.sqlite');

    expect(events).toEqual([
      'rename:/stage/home.sqlite->/active/home.sqlite',
      'sync:/stage',
      'close:/stage',
      'sync:/active',
      'close:/active',
    ]);
  });

  it('syncs parent metadata after removing a restore rollback artifact', async () => {
    events.length = 0;

    await removePathDurably('/config/server.env.restore-rollback');

    expect(events).toEqual([
      'rm:/config/server.env.restore-rollback',
      'sync:/config',
      'close:/config',
    ]);
  });
});
