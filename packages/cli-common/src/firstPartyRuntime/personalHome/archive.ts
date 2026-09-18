import { createHash } from 'node:crypto';
import { constants as bufferConstants } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, lstat, writeFile, rm, open, stat, statfs, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { getHeapStatistics } from 'node:v8';
import * as tar from 'tar';
import {
  assertAllowedPersonalHomeBackupDirectoryPath,
  assertAllowedPersonalHomeBackupPath,
  assertNonCollidingPersonalHomeBackupPaths,
  comparePersonalHomeBackupArtifactNames,
  isAllowedPersonalHomeBackupDirectoryPath,
  normalizePersonalHomeBackupDirectoryPath,
  parsePersonalHomeBackupManifest,
  serializePersonalHomeManifest,
  type PersonalHomeBackupManifestV1,
} from './manifest.js';
import { publishPersonalHomeFileNoClobberDurably } from './durableFile.js';
import { createPersonalHomePathProtection } from './protection.js';

export type PersonalHomeArchiveResult = Readonly<{ path: string; sha256: string; archiveBytes: number }>;
export type PersonalHomeArchiveResourceCapacity = Readonly<{
  availableBytes: number;
  availableEntries?: number;
  /** Available process memory for parser state, independently of destination storage capacity. */
  availableMemoryBytes?: number;
}>;
export class PersonalHomeArchiveError extends Error { constructor(public readonly code: 'invalid_archive' | 'hash_mismatch' | 'unsupported_archive' | 'resource_limit', message: string) { super(message); this.name = 'PersonalHomeArchiveError'; } }

export async function createPersonalHomeArchive(params: Readonly<{ stagingDir: string; outputPath: string; manifest: PersonalHomeBackupManifestV1 }>): Promise<PersonalHomeArchiveResult> {
  const staging = resolve(params.stagingDir); const output = resolve(params.outputPath);
  const protect = createPersonalHomePathProtection();
  await mkdir(staging, { recursive: true }); await mkdir(dirname(output), { recursive: true });
  const manifest = parsePersonalHomeBackupManifest(params.manifest);
  await writeFile(join(staging, 'manifest.json'), serializePersonalHomeManifest(manifest), { mode: 0o600 }); await protect(join(staging, 'manifest.json'), 'file');
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
  names.sort(comparePersonalHomeBackupArtifactNames);
  const manifestIndex = names.indexOf('manifest.json');
  if (manifestIndex < 0) throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup manifest is missing from staging');
  names.splice(manifestIndex, 1);
  names.unshift('manifest.json');
  const privateOutputDirectory = await mkdtemp(`${output}.tmp-`);
  const temporary = join(privateOutputDirectory, 'archive.tar');
  try {
    // Protect the containing directory before creating an authority-bearing file. In particular,
    // Windows must not expose an empty file that another user can open before its ACL is applied.
    await protect(privateOutputDirectory, 'directory');
    const emptyArchive = await open(temporary, 'wx', 0o600);
    await emptyArchive.close();
    await protect(temporary, 'file');
    // All file names are explicit, so directory recursion is disabled: naming a directory together
    // with its descendants makes node-tar emit duplicate Directory entries.
    await tar.create({ cwd: staging, file: temporary, mode: 0o600, portable: true, noMtime: true, follow: false, noDirRecurse: true }, names);
    const sha256 = await sha256File(temporary);
    await verifyPersonalHomeArchive(temporary);
    await publishPersonalHomeFileNoClobberDurably(temporary, output);
    return { path: output, sha256, archiveBytes: (await stat(output)).size };
  } finally { await rm(privateOutputDirectory, { recursive: true, force: true }); }
}

type ArchiveEntry = { path: string; type: 'File' | 'OldFile' | 'Directory'; declaredSize: number; actualSize: number; sha256?: string; manifestBytes?: Buffer };
export type PersonalHomeArchiveInspection = Readonly<{ manifest: PersonalHomeBackupManifestV1; archiveBytes: number; entryCount: number; extractedBytes: number }>;
export type PersonalHomeArchiveManifestMetadata = Readonly<{
  manifest: PersonalHomeBackupManifestV1;
  archiveBytes: number;
}>;

// Older v1 archives sorted the manifest among payload entries. Quick settings inspection skips
// payload bodies by offset and caps header decoding at 4 MiB (8,192 physical tar headers). Explicit
// Verify/Restore remain available for an old archive beyond this quick budget. New archives put it first.
export const PERSONAL_HOME_BACKUP_QUICK_INSPECTION_MAX_HEADERS = 8_192;
// Settings inventory runs in the long-lived CLI/desktop host and may inspect several archives.
// Cap one archive's transient manifest/PAX allocation to node-tar's 16 MiB default read window.
// This is not a backup/restore limit: explicit Verify and Restore parse the complete finite archive.
export const PERSONAL_HOME_BACKUP_QUICK_INSPECTION_MAX_MANIFEST_BYTES = 16 * 1024 * 1024;

function parseArchiveManifestBytes(bytes: Buffer): PersonalHomeBackupManifestV1 { return parsePersonalHomeBackupManifest(JSON.parse(bytes.toString('utf8'))); }

function assertCapacity(capacity: PersonalHomeArchiveResourceCapacity): void {
  if (!Number.isSafeInteger(capacity.availableBytes) || capacity.availableBytes < 0) throw new PersonalHomeArchiveError('resource_limit', 'Invalid Personal Home archive byte capacity');
  if (capacity.availableEntries !== undefined && (!Number.isSafeInteger(capacity.availableEntries) || capacity.availableEntries < 0)) throw new PersonalHomeArchiveError('resource_limit', 'Invalid Personal Home archive entry capacity');
  if (capacity.availableMemoryBytes !== undefined && (!Number.isSafeInteger(capacity.availableMemoryBytes) || capacity.availableMemoryBytes < 0)) throw new PersonalHomeArchiveError('resource_limit', 'Invalid Personal Home archive parser memory capacity');
}

type ParserMemoryBudget = Readonly<{ charge: (bytes: number, description: string) => void }>;

function createParserMemoryBudget(capacity: PersonalHomeArchiveResourceCapacity): ParserMemoryBudget {
  const heap = getHeapStatistics();
  const heapAvailable = Math.max(0, heap.heap_size_limit - heap.used_heap_size);
  const systemAvailable = process.availableMemory();
  let remaining = capacity.availableMemoryBytes ?? Math.floor(Math.min(heapAvailable, systemAvailable));
  return Object.freeze({
    charge(bytes: number, description: string): void {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > remaining) {
        throw new PersonalHomeArchiveError('resource_limit', `Personal Home backup ${description} exceeds available parser memory`);
      }
      remaining -= bytes;
    },
  });
}

function manifestWorkingSetBytes(bytes: number): number {
  // Full verification's public result owns the parsed manifest. While parsing it must retain the
  // tar body, decoded JSON, parsed values, and its canonical validated projection concurrently.
  // Accounting those four representations prevents a caller-controlled body from consuming the
  // process heap without imposing a fixed Home-size or entry-count policy.
  const workingSet = bytes * 4;
  if (!Number.isSafeInteger(workingSet)) throw new PersonalHomeArchiveError('resource_limit', 'Personal Home backup manifest parser accounting overflowed');
  return workingSet;
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

/**
 * Reads only the archive's manifest projection for settings inventory. This deliberately does not
 * hash or extract payload entries; explicit Verify and Restore own full archive verification.
 */
export async function readPersonalHomeArchiveManifestMetadata(path: string): Promise<PersonalHomeArchiveManifestMetadata> {
  const archiveInfo = await stat(path);
  if (!archiveInfo.isFile()) throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive is not a regular file');
  const source = await open(path, 'r');
  try {
    let position = 0;
    let headersRead = 0;
    let metadataBytesRead = 0;
    let extended: tar.HeaderData | undefined;
    let globalExtended: tar.HeaderData | undefined;
    while (position + 512 <= archiveInfo.size) {
      const headerBytes = Buffer.allocUnsafe(512);
      await readArchiveBytesExactly(source, headerBytes, position);
      headersRead += 1;
      if (headersRead > PERSONAL_HOME_BACKUP_QUICK_INSPECTION_MAX_HEADERS) {
        throw new PersonalHomeArchiveError('resource_limit', 'Personal Home backup manifest is beyond the quick-inspection header budget');
      }
      const header = new tar.Header(headerBytes, 0, extended, globalExtended);
      if (header.nullBlock) break;
      if (!header.cksumValid || !header.path || !Number.isSafeInteger(header.size) || (header.size ?? -1) < 0) {
        throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive header is invalid');
      }
      const bodySize = header.size ?? 0;
      const paddedBodySize = Math.ceil(bodySize / 512) * 512;
      const bodyPosition = position + 512;
      const nextPosition = bodyPosition + paddedBodySize;

      if (isPersonalHomeTarMetadataEntry(header.type)) {
        metadataBytesRead += bodySize;
        if (metadataBytesRead > PERSONAL_HOME_BACKUP_QUICK_INSPECTION_MAX_MANIFEST_BYTES) {
          throw new PersonalHomeArchiveError('resource_limit', 'Personal Home tar metadata exceeds the quick-inspection memory budget');
        }
        if (!Number.isSafeInteger(nextPosition) || nextPosition > archiveInfo.size) {
          throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive entry is truncated');
        }
        const metadata = Buffer.allocUnsafe(bodySize);
        await readArchiveBytesExactly(source, metadata, bodyPosition);
        const value = metadata.toString('utf8').replace(/\0.*$/s, '');
        if (header.type === 'ExtendedHeader' || header.type === 'OldExtendedHeader') extended = tar.Pax.parse(value, extended, false);
        else if (header.type === 'GlobalExtendedHeader') globalExtended = tar.Pax.parse(value, globalExtended, true);
        else {
          extended ??= Object.create(null) as tar.HeaderData;
          if (header.type === 'NextFileHasLongLinkpath') extended.linkpath = value;
          else extended.path = value;
        }
        position = nextPosition;
        continue;
      }

      extended = undefined;
      if (header.path !== 'manifest.json') {
        if (!Number.isSafeInteger(nextPosition) || nextPosition > archiveInfo.size) {
          throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive entry is truncated');
        }
        position = nextPosition;
        continue;
      }
      if ((header.type !== 'File' && header.type !== 'OldFile') || header.linkpath) {
        throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup manifest entry is invalid');
      }
      if (bodySize > PERSONAL_HOME_BACKUP_QUICK_INSPECTION_MAX_MANIFEST_BYTES) {
        throw new PersonalHomeArchiveError('resource_limit', 'Personal Home manifest bytes exceed the quick-inspection memory budget');
      }
      if (!Number.isSafeInteger(nextPosition) || nextPosition > archiveInfo.size) {
        throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive entry is truncated');
      }
      const manifestBytes = Buffer.allocUnsafe(bodySize);
      await readArchiveBytesExactly(source, manifestBytes, bodyPosition);
      return Object.freeze({ manifest: parseArchiveManifestBytes(manifestBytes), archiveBytes: archiveInfo.size });
    }
    throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup manifest is missing');
  } finally {
    await source.close();
  }
}

function isPersonalHomeTarMetadataEntry(type: tar.Header['type']): boolean {
  return type === 'ExtendedHeader' || type === 'OldExtendedHeader' || type === 'GlobalExtendedHeader'
    || type === 'NextFileHasLongPath' || type === 'OldGnuLongPath' || type === 'NextFileHasLongLinkpath';
}

async function readArchiveBytesExactly(source: FileHandle, target: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < target.length) {
    const { bytesRead } = await source.read(target, offset, target.length - offset, position + offset);
    if (bytesRead === 0) throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive entry is truncated');
    offset += bytesRead;
  }
}

export async function inspectPersonalHomeArchiveSnapshot(path: string, suppliedCapacity?: PersonalHomeArchiveResourceCapacity): Promise<PersonalHomeArchiveInspection> {
  const archiveInfo = await stat(path);
  if (!archiveInfo.isFile()) throw new PersonalHomeArchiveError('invalid_archive', 'Personal Home backup archive is not a regular file');
  // Verification streams payload bytes and never materializes extracted file content. It retains
  // only the manifest and structural/hash metadata required by its public result, charged against
  // the current process-memory budget. Extraction callers also add measured destination inode
  // capacity, including implicit ancestor directories.
  const capacity = suppliedCapacity ?? { availableBytes: archiveInfo.size };
  assertCapacity(capacity);
  const parserMemory = createParserMemoryBudget(capacity);
  const entries: ArchiveEntry[] = [];
  const filesystemEntries = new Set<string>();
  let extractedBytes = 0;
  let validationError: Error | null = null;
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
        parserMemory.charge(512 + Buffer.byteLength(entryPath, 'utf8') * 4, 'entry metadata');
        if (entryPath === 'manifest.json') {
          if (entry.size > bufferConstants.MAX_LENGTH) throw new PersonalHomeArchiveError('resource_limit', 'Personal Home backup manifest exceeds the runtime buffer contract');
          parserMemory.charge(manifestWorkingSetBytes(entry.size), 'manifest working set');
        }
        const components = entryPath.split('/');
        for (let length = 1; length <= components.length; length += 1) {
          const ancestor = components.slice(0, length).join('/');
          if (!filesystemEntries.has(ancestor)) {
            filesystemEntries.add(ancestor);
            parserMemory.charge(64 + ancestor.length * 2, 'path-index working set');
          }
          if (capacity.availableEntries !== undefined && filesystemEntries.size > capacity.availableEntries) {
            throw new PersonalHomeArchiveError('resource_limit', 'Personal Home backup needs more filesystem entries than the destination can stage');
          }
        }
      } catch (error) {
        validationError = error instanceof Error ? error : new Error(String(error));
        return;
      }
      const inspected: ArchiveEntry = { path: entryPath, type: entry.type, declaredSize: entry.size, actualSize: 0 };
      if (entryPath === 'manifest.json') inspected.manifestBytes = Buffer.allocUnsafe(entry.size);
      entries.push(inspected);
      const hash = createHash('sha256');
      entry.on('data', (chunk: Buffer) => {
        if (validationError) return;
        if (inspected.manifestBytes) chunk.copy(inspected.manifestBytes, inspected.actualSize);
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
      });
      entry.on('error', (error) => { validationError ??= error instanceof Error ? error : new Error(String(error)); });
      entry.on('end', () => { if (!validationError) inspected.sha256 = hash.digest('hex'); });
    },
  });
  if (validationError) throw validationError;
  for (const entry of entries) if (entry.actualSize !== entry.declaredSize) throw new PersonalHomeArchiveError('hash_mismatch', `Personal Home backup entry size does not match its header: ${entry.path}`);
  assertNonCollidingPersonalHomeBackupPaths(entries.map((entry) => ({ path: entry.path, kind: entry.type === 'Directory' ? 'directory' : 'file' })));
  const manifestEntry = entries.find((entry) => entry.path === 'manifest.json' && entry.type !== 'Directory');
  if (!manifestEntry?.manifestBytes) throw new Error('Personal Home backup manifest is missing');
  const manifest = parseArchiveManifestBytes(manifestEntry.manifestBytes);
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
  const manifest = parseArchiveManifestBytes(await readFile(join(destination, 'manifest.json')));
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

export async function inspectPersonalHomeArchive(path: string): Promise<PersonalHomeArchiveInspection> {
  try { return await withPrivatePersonalHomeArchiveSnapshot(path, inspectPersonalHomeArchiveSnapshot); }
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
    for (const name of (await readdir(dir)).sort(comparePersonalHomeBackupArtifactNames)) {
      const path = join(dir, name); const info = await lstat(path);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) throw new Error(`Unsupported link in backup: ${path}`);
      if (info.isDirectory()) { out.push({ path, directory: true }); await visit(path); } else if (info.isFile()) out.push({ path, directory: false }); else throw new Error(`Unsupported file type in backup: ${path}`);
    }
  }
  await visit(root); return out;
}
