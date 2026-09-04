import { link, lstat, open, readdir, rename, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Capability-style failures are tolerated because some supported runtimes cannot
// open directory handles for fsync. Access failures are never capability facts:
// on POSIX a rename may succeed while the parent fsync fails with EACCES/EPERM,
// and acknowledging that mutation as durable would advance recovery state past
// the bytes actually committed to stable storage.
const DIRECTORY_SYNC_UNSUPPORTED_CODES = new Set(['EINVAL', 'EISDIR', 'ENOTSUP']);

async function syncOpenPath(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectoryIfSupported(path: string): Promise<void> {
  try {
    await syncOpenPath(path);
  } catch (error) {
    if (!DIRECTORY_SYNC_UNSUPPORTED_CODES.has(String((error as NodeJS.ErrnoException).code ?? ''))) throw error;
  }
}

export async function syncPersonalHomeParentDirectory(path: string): Promise<void> {
  await syncDirectoryIfSupported(dirname(path));
}

export async function syncPersonalHomeFileAndParent(path: string): Promise<void> {
  await syncOpenPath(path);
  await syncPersonalHomeParentDirectory(path);
}

export async function removePathDurably(path: string): Promise<void> {
  const exists = await lstat(path).then(() => true).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (!exists) return;
  await rm(path, { recursive: true, force: true });
  await syncPersonalHomeParentDirectory(path);
}

/**
 * Flushes a restore candidate bottom-up before it is atomically promoted. Directory handles are
 * not syncable on every supported platform, so only the documented unsupported errors are ignored.
 */
export async function syncPersonalHomeTree(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Personal Home restore candidate must not be a symbolic link: ${path}`);
  if (!info.isDirectory()) {
    await syncOpenPath(path);
    return;
  }
  for (const name of await readdir(path)) await syncPersonalHomeTree(join(path, name));
  await syncDirectoryIfSupported(path);
}

/** The caller must flush source content first; this durably commits only the atomic namespace move. */
export async function renamePersonalHomePathDurably(sourcePath: string, targetPath: string): Promise<void> {
  await rename(sourcePath, targetPath);
  await syncPersonalHomeParentDirectory(sourcePath);
  if (dirname(sourcePath) !== dirname(targetPath)) await syncPersonalHomeParentDirectory(targetPath);
}

export async function replacePersonalHomeFileDurably(temporaryPath: string, targetPath: string): Promise<void> {
  await syncOpenPath(temporaryPath);
  await rename(temporaryPath, targetPath);
  await syncPersonalHomeParentDirectory(targetPath);
}

/** Publishes a completed sibling temporary file without ever replacing caller-owned bytes. */
export async function publishPersonalHomeFileNoClobberDurably(temporaryPath: string, targetPath: string): Promise<void> {
  await syncOpenPath(temporaryPath);
  await link(temporaryPath, targetPath);
  await syncPersonalHomeParentDirectory(targetPath);
  await unlink(temporaryPath);
  await syncPersonalHomeParentDirectory(temporaryPath);
}
