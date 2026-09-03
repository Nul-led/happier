import { cp, lstat, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { syncPersonalHomeParentDirectory, syncPersonalHomeTree } from './durableFile.js';

type RestorePromotionEntry = Readonly<{ target: string; source: string }>;
type FilesystemCapacity = Readonly<{ deviceId: string; availableBytes: number; availableEntries?: number }>;

type RestorePromotionFilesystem = Readonly<{
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  copy(source: string, target: string): Promise<void>;
  remove(path: string): Promise<void>;
  syncTree(path: string): Promise<void>;
}>;

const productionFilesystem: RestorePromotionFilesystem = {
  exists: async (path) => lstat(path).then(() => true).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  }),
  mkdir: async (path) => { await mkdir(path, { recursive: true, mode: 0o700 }); },
  copy: async (source, target) => { await cp(source, target, { recursive: true, errorOnExist: true, force: false }); },
  remove: async (path) => { await rm(path, { recursive: true, force: true }); },
  syncTree: syncPersonalHomeTree,
};

export async function preparePersonalHomeRestorePromotionSources(params: Readonly<{
  entries: readonly RestorePromotionEntry[];
  operationId: string;
  stageDeviceId: string;
  readFilesystemCapacity(path: string): Promise<FilesystemCapacity>;
  filesystem?: RestorePromotionFilesystem;
  beforeMaterialize?(entries: readonly RestorePromotionEntry[]): Promise<void>;
}>): Promise<Readonly<{ entries: readonly RestorePromotionEntry[]; candidatePaths: readonly string[] }>> {
  const filesystem = params.filesystem ?? productionFilesystem;
  const entries: RestorePromotionEntry[] = [];
  const candidatePaths: string[] = [];
  const materializations: Array<Readonly<{ originalSource: string; preparedSource: string; copy: boolean }>> = [];
  for (const entry of params.entries) {
    if (!(await filesystem.exists(entry.source))) {
      entries.push(entry);
      continue;
    }
    const targetDeviceId = (await params.readFilesystemCapacity(entry.target)).deviceId;
    if (targetDeviceId === params.stageDeviceId) {
      entries.push(entry);
      materializations.push({ originalSource: entry.source, preparedSource: entry.source, copy: false });
      continue;
    }
    const candidatePath = `${entry.target}.restore-candidate-${params.operationId}`;
    entries.push({ ...entry, source: candidatePath });
    candidatePaths.push(candidatePath);
    materializations.push({ originalSource: entry.source, preparedSource: candidatePath, copy: true });
  }
  await params.beforeMaterialize?.(entries);
  try {
    for (const materialization of materializations) {
      if (!materialization.copy) {
        await filesystem.syncTree(materialization.originalSource);
        if (!params.filesystem) await syncPersonalHomeParentDirectory(materialization.originalSource);
        continue;
      }
      const candidatePath = materialization.preparedSource;
      await filesystem.mkdir(dirname(candidatePath));
      await filesystem.remove(candidatePath);
      try {
        await filesystem.copy(materialization.originalSource, candidatePath);
        await filesystem.syncTree(candidatePath);
        if (!params.filesystem) await syncPersonalHomeParentDirectory(candidatePath);
      } catch (error) {
        await filesystem.remove(candidatePath).catch(() => undefined);
        throw error;
      }
    }
    return { entries, candidatePaths };
  } catch (error) {
    await Promise.all(candidatePaths.map(async (path) => filesystem.remove(path).catch(() => undefined)));
    throw error;
  }
}
