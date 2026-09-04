import { stat } from 'node:fs/promises';

async function getFileSizeBytes(path: string): Promise<number> {
  try {
    const file = await stat(path);
    return typeof file.size === 'number' && Number.isFinite(file.size)
      ? Math.max(0, Math.trunc(file.size))
      : 0;
  } catch {
    return 0;
  }
}

/** Physical SQLite storage charged to the memory index budget. */
export async function getSqliteFootprintBytes(dbPath: string): Promise<number> {
  const sizes = await Promise.all([
    getFileSizeBytes(dbPath),
    getFileSizeBytes(`${dbPath}-wal`),
    getFileSizeBytes(`${dbPath}-shm`),
  ]);
  return sizes.reduce((total, size) => total + size, 0);
}
