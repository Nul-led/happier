import { open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

const DIRECTORY_SYNC_UNSUPPORTED_CODES = new Set(['EACCES', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM']);

async function syncOpenPath(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function syncPersonalHomeParentDirectory(path: string): Promise<void> {
  try {
    await syncOpenPath(dirname(path));
  } catch (error) {
    if (!DIRECTORY_SYNC_UNSUPPORTED_CODES.has(String((error as NodeJS.ErrnoException).code ?? ''))) throw error;
  }
}

export async function syncPersonalHomeFileAndParent(path: string): Promise<void> {
  await syncOpenPath(path);
  await syncPersonalHomeParentDirectory(path);
}

export async function replacePersonalHomeFileDurably(temporaryPath: string, targetPath: string): Promise<void> {
  await syncOpenPath(temporaryPath);
  await rename(temporaryPath, targetPath);
  await syncPersonalHomeParentDirectory(targetPath);
}
