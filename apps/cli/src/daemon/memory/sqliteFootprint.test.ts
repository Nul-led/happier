import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getSqliteFootprintBytes } from './sqliteFootprint';

describe('getSqliteFootprintBytes', () => {
  it('reports the physical main, WAL, and SHM footprint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'happier-memory-sqlite-footprint-'));
    try {
      const dbPath = join(dir, 'memory.sqlite');
      await Promise.all([
        writeFile(dbPath, Buffer.alloc(5)),
        writeFile(`${dbPath}-wal`, Buffer.alloc(7)),
        writeFile(`${dbPath}-shm`, Buffer.alloc(11)),
      ]);

      await expect(getSqliteFootprintBytes(dbPath)).resolves.toBe(23);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
