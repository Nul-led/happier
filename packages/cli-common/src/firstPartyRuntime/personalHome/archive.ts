import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, lstat, writeFile, rm, open, stat, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import * as tar from 'tar';
import {
  assertAllowedPersonalHomeBackupDirectoryPath,
  assertAllowedPersonalHomeBackupPath,
  assertNonCollidingPersonalHomeBackupPaths,
  isAllowedPersonalHomeBackupDirectoryPath,
  normalizePersonalHomeBackupDirectoryPath,
  parsePersonalHomeBackupManifest,
  type PersonalHomeBackupManifestV1,
} from './manifest.js';
import { createPersonalHomePathProtection } from './protection.js';

export type PersonalHomeArchiveResult = Readonly<{ path: string; sha256: string; archiveBytes: number }>;
export type PersonalHomeArchiveResourceCapacity = Readonly<{ availableBytes: number; availableEntries?: number }>;
export class PersonalHomeArchiveError extends Error { constructor(public readonly code: 'invalid_archive' | 'hash_mismatch' | 'unsupported_archive' | 'resource_limit', message: string) { super(message); this.name = 'PersonalHomeArchiveError'; } }

export async function createPersonalHomeArchive(params: Readonly<{ stagingDir: string; outputPath: string; manifest: PersonalHomeBackupManifestV1 }>): Promise<PersonalHomeArchiveResult> {
  const staging = resolve(params.stagingDir); const output = resolve(params.outputPath);
  const protect = createPersonalHomePathProtection();
  await mkdir(staging, { recursive: true }); await mkdir(dirname(output), { recursive: true });
  const manifest = parsePersonalHomeBackupManifest(params.manifest);
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 }); await protect(join(staging, 'manifest.json'), 'file');
  const names: string[] = [];
  for (const item of await walk(staging)) {
    const name = relative(staging, item.path).split(sep).join('/');
    if (item.directory) {
      // Only the two fixed file roots and their descendants become explicit Directory entries;
      // other staging directories (database, secrets, configuration) are recreated implicitly by extraction.
      if (isAllowedPersonalHomeBackupDirectoryPath(name)) names.push(name);
    } else {
      assertAllowedPersonalHomeBackupPath(name);
      names.push(name);
    }
  }
  names.sort();
  const temporary = `${output}.tmp-${process.pid}-${randomUUID()}`;
  try {
    // All file names are explicit, so directory recursion is disabled: naming a directory together
    // with its descendants makes node-tar emit duplicate Directory entries.
    await tar.create({ cwd: staging, file: temporary, portable: true, noMtime: true, follow: false, noDirRecurse: true }, names);
    const handle = await open(temporary, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
    const sha256 = await sha256File(temporary); await protect(temporary, 'file');
    await verifyPersonalHomeArchive(temporary); await rename(temporary, output);
    return { path: output, sha256, archiveBytes: (await stat(output)).size };
  } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
}

type ArchiveEntry = { path: string; type: 'File' | 'OldFile' | 'Directory'; declaredSize: number; actualSize: number; sha256?: string; manifestBytes?: Buffer };
export type PersonalHomeArchiveInspection = Readonly<{ manifest: PersonalHomeBackupManifestV1; archiveBytes: number; entryCount: number; extractedBytes: number }>;

function assertCapacity(capacity: PersonalHomeArchiveResourceCapacity): void {
  if (!Number.isSafeInteger(capacity.availableBytes) || capacity.availableBytes < 0) throw new PersonalHomeArchiveError('resource_limit', 'Invalid Personal Home archive byte capacity');
  if (capacity.availableEntries !== undefined && (!Number.isSafeInteger(capacity.availableEntries) || capacity.availableEntries < 0)) throw new PersonalHomeArchiveError('resource_limit', 'Invalid Personal Home archive entry capacity');
}

async function defaultResourceCapacity(path: string): Promise<PersonalHomeArchiveResourceCapacity> {
  let probe = resolve(path);
  while (true) {
    try {
      const usage = await statfs(probe);
      return { availableBytes: usage.bavail * usage.bsize, availableEntries: usage.ffree };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(probe);
      if (parent === probe) throw error;
      probe = parent;
    }
  }
}

export async function inspectPersonalHomeArchiveSnapshot(path: string, suppliedCapacity?: PersonalHomeArchiveResourceCapacity): Promise<PersonalHomeArchiveInspection> {
  const archiveInfo = await stat(path);
  if (!archiveInfo.isFile()) throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive is not a regular file');
  // Verification itself streams from the immutable snapshot and allocates no extracted
  // content or filesystem entries. Its parser work remains physically bounded by the
  // finite archive bytes and tar headers in that snapshot. Extraction callers add the
  // measured destination inode capacity, including implicit ancestor directories.
  const capacity = suppliedCapacity ?? { availableBytes: archiveInfo.size };
  assertCapacity(capacity);
  const entries: ArchiveEntry[] = [];
  const filesystemEntries = new Set<string>();
  let extractedBytes = 0;
  let validationError: Error | null = null;
  const reads: Promise<void>[] = [];
  await tar.list({
    file: path,
    strict: true,
    preservePaths: true,
    onReadEntry: (entry: tar.ReadEntry) => {
      if (validationError) return;
      let entryPath: string;
      try {
        if (entry.type !== 'File' && entry.type !== 'OldFile' && entry.type !== 'Directory') throw new Error(`Unsupported archive entry type: ${entry.path}`);
        entryPath = entry.path;
        if (entry.type === 'Directory') {
          entryPath = normalizePersonalHomeBackupDirectoryPath(entryPath);
          assertAllowedPersonalHomeBackupDirectoryPath(entryPath);
        } else {
          assertAllowedPersonalHomeBackupPath(entryPath);
        }
        if (entry.linkpath) throw new Error(`Archive links are not supported: ${entryPath}`);
        if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new PersonalHomeArchiveError('invalid_archive', `Invalid archive entry size: ${entryPath}`);
        if (entry.size > capacity.availableBytes) throw new PersonalHomeArchiveError('resource_limit', `Personal Home backup entry exceeds destination byte capacity: ${entryPath}`);
        const components = entryPath.split('/');
        for (let length = 1; length <= components.length; length += 1) {
          filesystemEntries.add(components.slice(0, length).join('/'));
          if (capacity.availableEntries !== undefined && filesystemEntries.size > capacity.availableEntries) {
            throw new PersonalHomeArchiveError('resource_limit', 'Personal Home backup needs more filesystem entries than the destination can stage');
          }
        }
      } catch (error) {
        validationError = error instanceof Error ? error : new Error(String(error));
        return;
      }
      const inspected: ArchiveEntry = { path: entryPath, type: entry.type, declaredSize: entry.size, actualSize: 0 };
      entries.push(inspected);
      const read = new Promise<void>((resolveRead, rejectRead) => {
        const hash = createHash('sha256');
        const manifestChunks: Buffer[] = [];
        entry.on('data', (chunk: Buffer) => {
          if (validationError) return;
          inspected.actualSize += chunk.length;
          extractedBytes += chunk.length;
          if (!Number.isSafeInteger(inspected.actualSize) || !Number.isSafeInteger(extractedBytes)) {
            validationError = new PersonalHomeArchiveError('resource_limit', 'Personal Home backup byte accounting overflowed');
            return;
          }
          if (extractedBytes > capacity.availableBytes) {
            validationError = new PersonalHomeArchiveError('resource_limit', 'Personal Home backup exceeds destination byte capacity');
            return;
          }
          hash.update(chunk);
          if (entryPath === 'manifest.json') manifestChunks.push(Buffer.from(chunk));
        });
        entry.on('error', rejectRead);
        entry.on('end', () => {
          if (validationError) {
            resolveRead();
            return;
          }
          inspected.sha256 = hash.digest('hex');
          if (entryPath === 'manifest.json') inspected.manifestBytes = Buffer.concat(manifestChunks, inspected.actualSize);
          resolveRead();
        });
      });
      reads.push(read);
    },
  });
  await Promise.all(reads);
  if (validationError) throw validationError;
  for (const entry of entries) if (entry.actualSize !== entry.declaredSize) throw new PersonalHomeArchiveError('hash_mismatch', `Personal Home backup entry size does not match its header: ${entry.path}`);
  assertNonCollidingPersonalHomeBackupPaths(entries.map((entry) => ({ path: entry.path, kind: entry.type === 'Directory' ? 'directory' : 'file' })));
  const manifestEntry = entries.find((entry) => entry.path === 'manifest.json' && entry.type !== 'Directory');
  if (!manifestEntry?.manifestBytes) throw new Error('Personal Home backup manifest is missing');
  const manifest = parsePersonalHomeBackupManifest(JSON.parse(manifestEntry.manifestBytes.toString('utf8')));
  const expectedFiles = new Set(['manifest.json', ...manifest.entries.map((entry) => entry.path)]);
  const archiveFiles = entries.filter((entry) => entry.type !== 'Directory');
  if (archiveFiles.length !== expectedFiles.size || archiveFiles.some((entry) => !expectedFiles.has(entry.path))) throw new Error('Archive file entries do not match manifest');
  const byPath = new Map(archiveFiles.map((entry) => [entry.path, entry]));
  for (const expected of manifest.entries) {
    const actual = byPath.get(expected.path);
    if (!actual || actual.declaredSize !== expected.size || actual.actualSize !== expected.size || actual.sha256 !== expected.sha256) throw new PersonalHomeArchiveError('hash_mismatch', 'Personal Home backup content hash does not match its manifest');
  }
  return Object.freeze({ manifest, archiveBytes: archiveInfo.size, entryCount: entries.length, extractedBytes });
}

export async function withPrivatePersonalHomeArchiveSnapshot<T>(archivePath: string, useSnapshot: (snapshotPath: string) => Promise<T>, suppliedCapacity?: PersonalHomeArchiveResourceCapacity): Promise<T> {
  const privateDir = await mkdtemp(join(tmpdir(), 'happier-personal-home-archive-'));
  const snapshotPath = join(privateDir, 'archive.tar');
  const protect = createPersonalHomePathProtection();
  try {
    await protect(privateDir, 'directory');
    const source = await open(resolve(archivePath), 'r');
    try {
      const before = await source.stat();
      if (!before.isFile()) throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive is not a regular file');
      const capacity = suppliedCapacity ?? await defaultResourceCapacity(privateDir);
      assertCapacity(capacity);
      if (before.size > capacity.availableBytes) throw new PersonalHomeArchiveError('resource_limit', 'Insufficient temporary filesystem capacity for the Personal Home archive snapshot');
      const destination = await open(snapshotPath, 'wx', 0o600);
      try {
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let position = 0;
        while (position < before.size) {
          const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.byteLength, before.size - position), position);
          if (bytesRead === 0) throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home archive changed while its private snapshot was being created');
          let written = 0;
          while (written < bytesRead) written += (await destination.write(buffer, written, bytesRead - written, position + written)).bytesWritten;
          position += bytesRead;
        }
        await destination.sync();
      } finally { await destination.close(); }
      const after = await source.stat();
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home archive changed while its private snapshot was being created');
    } finally { await source.close(); }
    await protect(snapshotPath, 'file');
    return await useSnapshot(snapshotPath);
  } finally {
    await rm(privateDir, { recursive: true, force: true });
  }
}

/** Consumes an archive path already held inside a private immutable operation snapshot. */
export async function extractVerifiedPersonalHomeArchiveSnapshot(archivePath: string, destinationDir: string, suppliedCapacity?: PersonalHomeArchiveResourceCapacity): Promise<PersonalHomeBackupManifestV1> {
  const capacity = suppliedCapacity ?? await defaultResourceCapacity(destinationDir);
  const inspection = await inspectPersonalHomeArchiveSnapshot(archivePath, capacity);
  const protect = createPersonalHomePathProtection();
  const destination = resolve(destinationDir); await mkdir(destination, { recursive: true, mode: 0o700 }); await protect(destination, 'directory');
  await tar.extract({ file: archivePath, cwd: destination, strict: true, preservePaths: false, follow: false });
  const entries: ArchiveEntry[] = [];
  await tar.list({ file: archivePath, strict: true, preservePaths: true, onReadEntry: (entry) => { entries.push({ path: entry.type === 'Directory' ? normalizePersonalHomeBackupDirectoryPath(entry.path) : entry.path, type: entry.type as ArchiveEntry['type'], declaredSize: entry.size, actualSize: entry.size }); } });
  for (const entry of entries) {
    const file = resolve(destination, entry.path); const info = await lstat(file);
    if (entry.type === 'Directory') {
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsupported extracted archive entry: ${entry.path}`);
      await protect(file, 'directory');
      continue;
    }
    if (!info.isFile() || info.isSymbolicLink() || info.nlink > 1) throw new Error(`Unsupported extracted archive entry: ${entry.path}`);
    await protect(file, 'file');
    let parent = dirname(file);
    while (parent !== destination) { await protect(parent, 'directory'); parent = dirname(parent); }
  }
  const manifest = parsePersonalHomeBackupManifest(JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8')));
  if (JSON.stringify(manifest) !== JSON.stringify(inspection.manifest)) throw new PersonalHomeArchiveError('hash_mismatch', 'Extracted Personal Home manifest changed after verification');
  const expectedFiles = new Set(['manifest.json', ...manifest.entries.map((entry) => entry.path)]);
  const archiveFiles = entries.filter((entry) => entry.type !== 'Directory');
  if (archiveFiles.length !== expectedFiles.size || archiveFiles.some((entry) => !expectedFiles.has(entry.path))) throw new Error('Archive file entries do not match manifest');
  for (const entry of manifest.entries) {
    const file = join(destination, entry.path); const info = await stat(file);
    if (info.size !== entry.size || await sha256File(file) !== entry.sha256) throw new PersonalHomeArchiveError('hash_mismatch', 'Personal Home backup content hash does not match its manifest');
  }
  return manifest;
}

export async function extractVerifiedPersonalHomeArchive(archivePath: string, destinationDir: string): Promise<PersonalHomeBackupManifestV1> { try { return await withPrivatePersonalHomeArchiveSnapshot(archivePath, (snapshotPath) => extractVerifiedPersonalHomeArchiveSnapshot(snapshotPath, destinationDir)); } catch (error) { if (error instanceof PersonalHomeArchiveError) throw error; throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive is invalid'); } }

async function sha256File(path: string): Promise<string> { const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex'); }

export async function verifyPersonalHomeArchive(path: string): Promise<PersonalHomeBackupManifestV1> {
  try { return await withPrivatePersonalHomeArchiveSnapshot(path, verifyPersonalHomeArchiveSnapshot); }
  catch (error) { if (error instanceof PersonalHomeArchiveError) throw error; throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive is invalid'); }
}

/** Verifies an archive path already held inside a private immutable operation snapshot. */
export async function verifyPersonalHomeArchiveSnapshot(snapshotPath: string, suppliedCapacity?: PersonalHomeArchiveResourceCapacity): Promise<PersonalHomeBackupManifestV1> {
  try { return (await inspectPersonalHomeArchiveSnapshot(snapshotPath, suppliedCapacity)).manifest; }
  catch (error) { if (error instanceof PersonalHomeArchiveError) throw error; throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive is invalid'); }
}

async function walk(root: string): Promise<Array<Readonly<{ path: string; directory: boolean }>>> {
  const out: Array<Readonly<{ path: string; directory: boolean }>> = [];
  async function visit(dir: string): Promise<void> {
    const { readdir } = await import('node:fs/promises');
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name); const info = await lstat(path);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) throw new Error(`Unsupported link in backup: ${path}`);
      if (info.isDirectory()) { out.push({ path, directory: true }); await visit(path); } else if (info.isFile()) out.push({ path, directory: false }); else throw new Error(`Unsupported file type in backup: ${path}`);
    }
  }
  await visit(root); return out;
}
