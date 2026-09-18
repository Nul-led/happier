import { describe, expect, it, vi } from 'vitest';

const events: string[] = [];

vi.mock('node:fs/promises', () => ({
  link: vi.fn(async () => undefined),
  lstat: vi.fn(async () => ({ isDirectory: () => true })),
  mkdir: vi.fn(async () => undefined),
  open: vi.fn(async (path: string) => ({
    sync: async () => { events.push(`sync:${path}`); },
    close: async () => { events.push(`close:${path}`); },
  })),
  readFile: vi.fn(async () => ''),
  readdir: vi.fn(async () => []),
  rename: vi.fn(async () => undefined),
  rm: vi.fn(async (path: string) => { events.push(`rm:${path}`); }),
  stat: vi.fn(async () => ({ isFile: () => true })),
  unlink: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

import { cleanupPersonalHomeRelocationUpload } from './relocationTransfer.js';

describe('Personal Home relocation upload cleanup durability', () => {
  it('synchronizes the owning directory after removing plaintext transfer material', async () => {
    events.length = 0;

    await cleanupPersonalHomeRelocationUpload({
      operationId: 'durable-cleanup',
      temporaryRoot: '/temporary-root',
    });

    expect(events).toHaveLength(3);
    expect(events[0]).toMatch(/^rm:\/temporary-root\/happier-personal-home-relocation\/[a-f0-9]{64}$/u);
    expect(events[1]).toBe('sync:/temporary-root/happier-personal-home-relocation');
    expect(events[2]).toBe('close:/temporary-root/happier-personal-home-relocation');
  });
});
