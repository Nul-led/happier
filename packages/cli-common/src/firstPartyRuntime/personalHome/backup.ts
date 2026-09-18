import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, lstat, cp, opendir, readdir, writeFile, rm, stat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';
import { createPersonalHomeArchive, PersonalHomeArchiveError, readPersonalHomeArchiveManifestMetadata, verifyPersonalHomeArchive } from './archive.js';
import { type PersonalHomeRuntimeLayout } from './layout.js';
import { comparePersonalHomeBackupArtifactNames, fingerprintMasterSecret, type PersonalHomeBackupEntry, type PersonalHomeBackupManifestV1 } from './manifest.js';
import { assertStablePersonalHomeSqliteSnapshot, PersonalHomeSqliteSnapshotError } from './sqliteSnapshot.js';
import { withPersonalHomeOperationLock } from './lock.js';
import {
  normalizePersonalHomeRestorableConfigurationV1,
  serializePersonalHomeRestorableConfigurationV1,
} from './configuration.js';
import { createPersonalHomePathProtection, type PersonalHomePathProtection } from './protection.js';

export type PersonalHomeBackupCleanupRequired = Readonly<{
  kind: 'backup_staging';
  path: string;
  error: string;
}>;
export type PersonalHomeBackupResult = Readonly<{
  path: string;
  manifest: PersonalHomeBackupManifestV1;
  sha256: string;
  archiveBytes: number;
  homeNeedsAttention?: boolean;
  cleanupRequired?: PersonalHomeBackupCleanupRequired;
}>;
export type PersonalHomeSqliteMaintenance = Readonly<{
  checkpoint: () => Promise<{ busy: number }>;
  quickCheck: () => Promise<boolean>;
  close: () => Promise<void>;
}>;

async function addFile(source: string, staging: string, archivePath: string, entries: PersonalHomeBackupEntry[], protect: PersonalHomePathProtection): Promise<void> {
  const info = await lstat(source); if (!info.isFile() || info.nlink > 1) throw new Error(`Backup source is not a regular file: ${source}`);
  const hash = createHash('sha256'); for await (const chunk of createReadStream(source)) hash.update(chunk);
  const target = join(staging, archivePath); await mkdir(dirname(target), { recursive: true }); await protect(dirname(target), 'directory'); await cp(source, target); await protect(target, 'file'); entries.push({ path: archivePath, size: info.size, sha256: hash.digest('hex') });
}
async function addTree(source: string, staging: string, prefix: string, entries: PersonalHomeBackupEntry[], protect: PersonalHomePathProtection, excludedPath?: string): Promise<void> {
  let names: string[]; try { names = await readdir(source); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  // Materialize roots and nested directories so the archive owner can emit validated structural
  // directory headers. Manifest v1 remains file-only and hashes content bytes only.
  await mkdir(join(staging, prefix), { recursive: true });
  await protect(join(staging, prefix), 'directory');
  for (const name of names.sort(comparePersonalHomeBackupArtifactNames)) { const sourcePath = join(source, name); if (excludedPath && resolve(sourcePath) === resolve(excludedPath)) continue; const info = await lstat(sourcePath); const archivePath = join(prefix, name).split('\\').join('/'); if (info.isDirectory()) await addTree(sourcePath, staging, archivePath, entries, protect, excludedPath); else await addFile(sourcePath, staging, archivePath, entries, protect); }
}
function overlaps(left: string, right: string): boolean { const relation = relative(resolve(left), resolve(right)); return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation)); }

function resolvePlatformTrustBoundary(path: string): string {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const firstSegment = relative(root, absolute).split(/[\\/]+/u).find(Boolean);
  return firstSegment ? resolve(root, firstSegment) : root;
}

async function assertCanonicalDescendant(boundary: string, candidate: string, message: string): Promise<void> {
  const lexicalBoundary = resolve(boundary);
  const lexicalCandidate = resolve(candidate);
  if (!overlaps(lexicalBoundary, lexicalCandidate)) throw new Error(message);
  const canonicalBoundary = await realpath(lexicalBoundary);
  const canonicalCandidate = await realpath(lexicalCandidate);
  const expectedCandidate = resolve(canonicalBoundary, relative(lexicalBoundary, lexicalCandidate));
  if (canonicalCandidate !== expectedCandidate) throw new Error(message);
}

async function assertSafeOutputPath(layout: PersonalHomeRuntimeLayout, outputPath: string, stagingDir: string): Promise<void> {
  const output = resolve(outputPath); const staging = resolve(stagingDir); const backups = resolve(layout.backupsDir);
  if (overlaps(output, staging) || overlaps(staging, output)) throw new Error('Personal Home backup output overlaps staging');
  const insideBackups = overlaps(backups, output);
  for (const source of [layout.databasePath, layout.masterSecretPath, layout.publicFilesDir, layout.privateFilesDir, layout.configDir, layout.installRoot, layout.derivedDataDir]) {
    if ((!insideBackups || resolve(source) !== resolve(layout.installRoot)) && (overlaps(source, output) || overlaps(output, source))) throw new Error('Personal Home backup output overlaps a Home source or runtime root');
  }
  let ancestor = dirname(output);
  while (true) {
    try {
      if (insideBackups) {
        await assertCanonicalDescendant(
          layout.dataDir,
          ancestor,
          'Personal Home backup output uses a symbolic-link ancestor or escapes its canonical root',
        );
      } else {
        await assertCanonicalDescendant(
          resolvePlatformTrustBoundary(ancestor),
          ancestor,
          'Personal Home backup output uses a symbolic-link ancestor',
        );
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
    }
  }
}

export async function createPersonalHomeBackup(params: Readonly<{
  layout: PersonalHomeRuntimeLayout; outputPath: string; stagingDir: string; homeServerIdentityId: string; schemaVersion: string; happierVersion: string; configuration: Record<string, unknown>; sqlite: PersonalHomeSqliteMaintenance; wasRunning?: boolean; stopHome?: () => Promise<void>; startHome?: () => Promise<void>; cleanupStaging?: (path: string) => Promise<void>;
}>): Promise<PersonalHomeBackupResult> {
  return withPersonalHomeOperationLock(params.layout.dataDir, 'backup', () =>
    createPersonalHomeBackupWithLease({ ...params, operationLeaseHeld: true }));
}

/** Package-internal primitive for callers that already hold the canonical Home operation lease. */
export async function createPersonalHomeBackupWithLease(params: Readonly<{
  layout: PersonalHomeRuntimeLayout; outputPath: string; stagingDir: string; homeServerIdentityId: string; schemaVersion: string; happierVersion: string; configuration: Record<string, unknown>; sqlite: PersonalHomeSqliteMaintenance; wasRunning?: boolean; stopHome?: () => Promise<void>; startHome?: () => Promise<void>; cleanupStaging?: (path: string) => Promise<void>; operationLeaseHeld: true;
}>): Promise<PersonalHomeBackupResult> {
    if (!params.sqlite || typeof params.sqlite.close !== 'function') {
      throw new PersonalHomeSqliteSnapshotError('sqlite_maintenance_required', 'SQLite maintenance with an explicit close boundary is required');
    }
    if (params.wasRunning && !params.stopHome) throw new Error('Backup requires a stopHome callback when the Home is running');
    if (params.wasRunning && !params.startHome) throw new Error('Backup requires a startHome callback when the Home is running');
    let homeNeedsAttention = false;
    if (params.wasRunning) await params.stopHome!();
    const staging = resolve(params.stagingDir);
    const dataDir = resolve(params.layout.dataDir);
    const output = resolve(params.outputPath);
    await assertSafeOutputPath(params.layout, output, staging);
    const stagingFromData = relative(dataDir, staging);
    const outputFromStaging = relative(staging, output);
    if (
      stagingFromData === ''
      || (!stagingFromData.startsWith('..') && !isAbsolute(stagingFromData))
      || outputFromStaging === ''
      || (!outputFromStaging.startsWith('..') && !isAbsolute(outputFromStaging))
    ) {
      throw new Error('Personal Home backup staging must be separate from Home files and output');
    }
    let backupResult: PersonalHomeBackupResult | undefined;
    let cleanupRequired: PersonalHomeBackupCleanupRequired | undefined;
    const protect = createPersonalHomePathProtection({ platform: params.layout.platform });
    try {
      try {
        await assertStablePersonalHomeSqliteSnapshot({ databasePath: params.layout.databasePath, ...params.sqlite, checkSidecars: false });
      } finally {
        await params.sqlite.close();
      }
      for (const suffix of ['-wal', '-shm']) {
        try {
          if ((await stat(`${params.layout.databasePath}${suffix}`)).size > 0) {
            throw new PersonalHomeSqliteSnapshotError('sqlite_snapshot_unstable', `SQLite sidecar remains after maintenance close: ${suffix}`);
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      const databaseBefore = await stat(params.layout.databasePath);
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      await protect(staging, 'directory');
      const entries: PersonalHomeBackupEntry[] = [];
      await addFile(params.layout.databasePath, staging, 'database/home.sqlite', entries, protect);
      const databaseAfter = await stat(params.layout.databasePath);
      if (databaseAfter.size !== databaseBefore.size || databaseAfter.mtimeMs !== databaseBefore.mtimeMs) throw new PersonalHomeSqliteSnapshotError('sqlite_snapshot_unstable', 'SQLite database changed during backup');
      for (const suffix of ['-wal', '-shm']) { try { if ((await stat(`${params.layout.databasePath}${suffix}`)).size > 0) throw new PersonalHomeSqliteSnapshotError('sqlite_snapshot_unstable', `SQLite sidecar remains: ${suffix}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } }
      await addTree(params.layout.publicFilesDir, staging, 'files/public', entries, protect, params.layout.privateFilesDir);
      await addTree(params.layout.privateFilesDir, staging, 'files/private', entries, protect);
      await addFile(params.layout.masterSecretPath, staging, 'secrets/handy-master-secret.txt', entries, protect);
      const configBytes = Buffer.from(serializePersonalHomeRestorableConfigurationV1(
        normalizePersonalHomeRestorableConfigurationV1(params.configuration, params.homeServerIdentityId),
      )); const configPath = join(staging, 'configuration/home.env.json'); await mkdir(dirname(configPath), { recursive: true }); await protect(dirname(configPath), 'directory'); await writeFile(configPath, configBytes, { mode: 0o600 }); await protect(configPath, 'file'); entries.push({ path: 'configuration/home.env.json', size: configBytes.byteLength, sha256: createHash('sha256').update(configBytes).digest('hex') });
      const manifest: PersonalHomeBackupManifestV1 = { format: 'happier-personal-home-backup', version: 1, createdAt: new Date().toISOString(), happierVersion: params.happierVersion, schemaVersion: params.schemaVersion, homeServerIdentityId: params.homeServerIdentityId, masterSecretFingerprint: fingerprintMasterSecret(await readFile(params.layout.masterSecretPath)), databaseProvider: 'sqlite', filesProvider: 'local', sourcePlatform: params.layout.platform, sourceRuntimeMode: params.layout.mode, entries: entries.sort((a, b) => comparePersonalHomeBackupArtifactNames(a.path, b.path)) };
      const archive = await createPersonalHomeArchive({ stagingDir: staging, outputPath: params.outputPath, manifest });
      await verifyPersonalHomeArchive(archive.path);
      backupResult = { path: archive.path, manifest, sha256: archive.sha256, archiveBytes: archive.archiveBytes };
    } finally {
      const cleanupStaging = params.cleanupStaging ?? (async (path: string) => rm(path, { recursive: true, force: true }));
      try {
        await cleanupStaging(staging);
      } catch {
        try {
          await cleanupStaging(staging);
        } catch (error) {
          const detail = error instanceof Error && error.message.trim() ? error.message.trim() : 'unknown platform error';
          cleanupRequired = { kind: 'backup_staging', path: staging, error: detail };
        }
      }
      if (params.wasRunning && params.startHome) await params.startHome().catch(() => { homeNeedsAttention = true; });
    }
    if (!backupResult) throw new Error('Personal Home backup did not produce a result');
    return {
      ...backupResult,
      ...(homeNeedsAttention ? { homeNeedsAttention: true } : {}),
      ...(cleanupRequired ? { cleanupRequired } : {}),
    };
}

export type PersonalHomeBackupArchiveInventoryEntry = Readonly<{ path: string; createdAt: string; archiveBytes: number }>;

export type PersonalHomeBackupArchiveInventory = Readonly<{
  /** Confirmed Personal Home archives; exact when `complete`, otherwise a confirmed lower bound. */
  count: number;
  /** False only when a candidate could not be quick-confirmed within the parser's real resource limits. */
  complete: boolean;
  /** Newest archive by manifest creation time only when the inventory is complete. */
  latest: PersonalHomeBackupArchiveInventoryEntry | null;
}>;

export async function listPersonalHomeBackupArchives(
  backupsDir: string,
  checkCancelled: () => void = () => undefined,
): Promise<PersonalHomeBackupArchiveInventory> {
  let count = 0;
  let complete = true;
  let latest: PersonalHomeBackupArchiveInventoryEntry | null = null;
  try {
    const directory = await opendir(backupsDir);
    for await (const entry of directory) {
      checkCancelled();
      if (!entry.isFile() || !entry.name.endsWith('.tar')) continue;
      const candidate = resolve(backupsDir, entry.name);
      try {
        const metadata = await readPersonalHomeArchiveManifestMetadata(candidate);
        const confirmed = { path: candidate, createdAt: metadata.manifest.createdAt, archiveBytes: metadata.archiveBytes };
        count += 1;
        const confirmedCreatedAt = Date.parse(confirmed.createdAt);
        const latestCreatedAt = latest ? Date.parse(latest.createdAt) : Number.NEGATIVE_INFINITY;
        if (!latest
          || confirmedCreatedAt > latestCreatedAt
          || (confirmedCreatedAt === latestCreatedAt && comparePersonalHomeBackupArtifactNames(confirmed.path, latest.path) > 0)) {
          latest = confirmed;
        }
      } catch (error) {
        // A candidate the quick parser cannot confirm may still be a valid legacy archive, so
        // exact count/latest facts are unavailable. Structurally invalid or disappearing files
        // are not current Personal Home archive facts.
        if (error instanceof PersonalHomeArchiveError && error.code === 'resource_limit') complete = false;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { count: 0, complete: true, latest: null };
    throw error;
  }
  return { count, complete, latest: complete ? latest : null };
}
