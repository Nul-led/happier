import { lstat, readdir, rm } from 'node:fs/promises';
import type { PathLike, Stats } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

import { resolvePersonalHomeRuntimeArtifactPaths, type PersonalHomeRuntimeLayout } from './layout.js';
import { isPersonalHomeOperationLockHeld } from './lock.js';

export class PersonalHomeEraseError extends Error {
  readonly code: 'confirmation_required' | 'unsafe_data_root';

  constructor(code: PersonalHomeEraseError['code'], message: string) {
    super(message);
    this.name = 'PersonalHomeEraseError';
    this.code = code;
  }
}

export type PersonalHomeEraseResult = Readonly<{
  outcome: 'completed' | 'completed_with_cleanup_attention' | 'partial';
  removedPaths: readonly string[];
  remainingOwnedPaths: readonly string[];
  remainingUnknownPaths: readonly string[];
  inspectionComplete: boolean;
  inspectionError: string | null;
  error: string | null;
}>;

type PersonalHomeEraseFilesystem = Readonly<{
  lstat(path: PathLike): Promise<Stats>;
  readdir(path: PathLike): Promise<string[]>;
  rm: typeof rm;
}>;

const defaultFilesystem: PersonalHomeEraseFilesystem = { lstat, readdir, rm };
const pathApi = (platform: NodeJS.Platform) => platform === 'win32' ? win32 : posix;
const comparablePath = (platform: NodeJS.Platform, value: string): string => {
  const api = pathApi(platform);
  const normalized = api.normalize(api.resolve(value));
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
};
const isWithinPath = (platform: NodeJS.Platform, root: string, candidate: string): boolean => {
  const api = pathApi(platform);
  const normalizedRoot = comparablePath(platform, root);
  const normalizedCandidate = comparablePath(platform, candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${api.sep}`);
};

export function resolvePersonalHomeEraseTargets(layout: PersonalHomeRuntimeLayout): readonly string[] {
  const api = pathApi(layout.platform);
  const dataRoot = api.resolve(layout.dataDir);
  const artifacts = resolvePersonalHomeRuntimeArtifactPaths(layout);
  return [...new Set([
    layout.databasePath, `${layout.databasePath}-wal`, `${layout.databasePath}-shm`, layout.publicFilesDir,
    layout.privateFilesDir, layout.masterSecretPath, layout.backupsDir, layout.derivedDataDir,
    layout.irohEndpointKeyPath, artifacts.irohEndpointDescriptorPath, artifacts.homeConnectionDescriptorPath,
    artifacts.startupReceiptPath, artifacts.updateRecoveryPath, artifacts.restoreJournalPath,
    artifacts.relocationSourcePath, artifacts.relocationDestinationPath,
    api.resolve(layout.configDir, 'server.env'),
  ].map((path) => api.resolve(path)))];
}

function resolveValidatedDataRoot(layout: PersonalHomeRuntimeLayout, userHomeDir: string): string {
  const api = pathApi(layout.platform);
  const dataRoot = api.normalize(api.resolve(layout.dataDir));
  const comparableDataRoot = comparablePath(layout.platform, dataRoot);
  if (!api.isAbsolute(dataRoot)
    || comparableDataRoot === comparablePath(layout.platform, api.parse(dataRoot).root)
    || comparableDataRoot === comparablePath(layout.platform, userHomeDir)) {
    throw new PersonalHomeEraseError('unsafe_data_root', 'Refusing to erase an unsafe Personal Home data root.');
  }
  const protectedRoots = [dataRoot, userHomeDir].map((value) => comparablePath(layout.platform, value));
  for (const directory of [layout.publicFilesDir, layout.privateFilesDir, layout.backupsDir, layout.derivedDataDir]) {
    const candidate = comparablePath(layout.platform, directory);
    const root = comparablePath(layout.platform, api.parse(api.resolve(directory)).root);
    const containsProtectedRoot = protectedRoots.some((protectedRoot) => (
      protectedRoot === candidate || protectedRoot.startsWith(`${candidate}${api.sep}`)
    ));
    if (candidate === root || containsProtectedRoot) {
      throw new PersonalHomeEraseError('unsafe_data_root', `Refusing to erase an overlapping Personal Home directory target: ${directory}`);
    }
  }
  return dataRoot;
}

/** Validates the complete destructive target set without deleting anything. The returned
 * operation is the irreversible boundary and must be invoked under the same Home lease. */
export async function preparePersonalHomeDataErase(params: Readonly<{
  layout: PersonalHomeRuntimeLayout;
  operationLeaseHeld: true;
  operation?: 'erase' | 'relocate';
  userHomeDir?: string;
}>, filesystem: PersonalHomeEraseFilesystem = defaultFilesystem): Promise<() => Promise<PersonalHomeEraseResult>> {
  const api = pathApi(params.layout.platform);
  const dataRoot = resolveValidatedDataRoot(params.layout, params.userHomeDir ?? homedir());
  const artifacts = resolvePersonalHomeRuntimeArtifactPaths(params.layout);
  for (const target of [
    params.layout.irohEndpointKeyPath,
    artifacts.irohEndpointDescriptorPath,
    artifacts.homeConnectionDescriptorPath,
    artifacts.startupReceiptPath,
    artifacts.updateRecoveryPath,
    artifacts.restoreJournalPath,
    artifacts.relocationSourcePath,
    artifacts.relocationDestinationPath,
  ]) {
    if (!isWithinPath(params.layout.platform, dataRoot, target)) {
      throw new PersonalHomeEraseError('unsafe_data_root', `Refusing to erase a runtime artifact outside the canonical data root: ${target}`);
    }
  }
  if (!(await isPersonalHomeOperationLockHeld(dataRoot, params.operation ?? 'erase'))) {
    throw new PersonalHomeEraseError('unsafe_data_root', 'Personal Home erase requires the facade operation lease.');
  }
  const targets = resolvePersonalHomeEraseTargets(params.layout)
    .filter((target) => comparablePath(params.layout.platform, target) !== comparablePath(params.layout.platform, artifacts.operationLockPath));
  const protectedRoots = [api.parse(dataRoot).root, params.userHomeDir ?? homedir()]
    .map((value) => comparablePath(params.layout.platform, value));
  for (const target of targets) {
    const candidate = comparablePath(params.layout.platform, target);
    if (protectedRoots.some((protectedRoot) => (
      candidate === protectedRoot || protectedRoot.startsWith(`${candidate}${api.sep}`)
    ))) {
      throw new PersonalHomeEraseError('unsafe_data_root', `Refusing to erase an overlapping Personal Home target: ${target}`);
    }
  }
  const existingTargets: string[] = [];
  for (const target of targets) {
    const info = await filesystem.lstat(target).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!info) continue;
    if (info.isSymbolicLink()) throw new PersonalHomeEraseError('unsafe_data_root', `Refusing to erase symbolic-link Home target: ${target}`);
    existingTargets.push(target);
  }

  const ownedTargetSet = new Set(targets.map((target) => comparablePath(params.layout.platform, target)));
  const retainedPathSet = new Set([
    comparablePath(params.layout.platform, artifacts.operationLockPath),
  ]);
  const readRemainingUnknownPaths = async (): Promise<readonly string[]> => {
    const unknown: string[] = [];
    const collect = async (directory: string): Promise<void> => {
      const names = await filesystem.readdir(directory).catch(
        (error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error),
      );
      for (const name of names) {
        const candidate = api.resolve(directory, name);
        const comparable = comparablePath(params.layout.platform, candidate);
        if (ownedTargetSet.has(comparable) || retainedPathSet.has(comparable)) continue;
        const info = await filesystem.lstat(candidate).catch(
          (error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error),
        );
        if (!info) continue;
        if (info.isDirectory() && !info.isSymbolicLink()) await collect(candidate);
        else unknown.push(candidate);
      }
    };
    await collect(dataRoot);
    return unknown;
  };

  return async () => {
    const removedPaths: string[] = [];
    for (let index = 0; index < existingTargets.length; index += 1) {
      const target = existingTargets[index]!;
      try {
        await filesystem.rm(target, { recursive: true, force: true });
        await filesystem.lstat(target).then(
          () => { throw new Error(`Personal Home erase postcondition failed: ${target}`); },
          (error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; },
        );
        removedPaths.push(target);
      } catch (error) {
        const detail = error instanceof Error && error.message.trim() ? error.message.trim() : 'unknown platform error';
        const remainingOwnedPaths = (
          await Promise.all(existingTargets.slice(index).map(async (candidate) => {
            try {
              await filesystem.lstat(candidate);
              return candidate;
            } catch (inspectionError) {
              return (inspectionError as NodeJS.ErrnoException).code === 'ENOENT' ? null : candidate;
            }
          }))
        ).filter((candidate): candidate is string => candidate !== null);
        let remainingUnknownPaths: readonly string[] = [];
        let unknownInspectionError: string | null = null;
        try {
          remainingUnknownPaths = await readRemainingUnknownPaths();
        } catch (inspectionError) {
          unknownInspectionError = inspectionError instanceof Error && inspectionError.message.trim()
            ? inspectionError.message.trim()
            : 'unknown platform error';
        }
        return {
          outcome: 'partial',
          removedPaths,
          remainingOwnedPaths,
          remainingUnknownPaths,
          inspectionComplete: unknownInspectionError === null,
          inspectionError: unknownInspectionError,
          error: `Failed to remove Personal Home target ${target}: ${detail}${unknownInspectionError
            ? `; remaining unknown-path inspection also failed: ${unknownInspectionError}`
            : ''}`,
        };
      }
    }
    let remainingUnknownPaths: readonly string[] = [];
    try {
      remainingUnknownPaths = await readRemainingUnknownPaths();
      await filesystem.lstat(artifacts.operationLockPath);
      return { outcome: 'completed', removedPaths, remainingOwnedPaths: [], remainingUnknownPaths, inspectionComplete: true, inspectionError: null, error: null };
    } catch (error) {
      const detail = error instanceof Error && error.message.trim() ? error.message.trim() : 'unknown platform error';
      return {
        outcome: 'completed_with_cleanup_attention',
        removedPaths,
        remainingOwnedPaths: [],
        remainingUnknownPaths,
        inspectionComplete: false,
        inspectionError: detail,
        error: `Personal Home data was removed, but residual-path inspection needs attention: ${detail}`,
      };
    }
  };
}

export async function erasePersonalHomeData(
  params: Parameters<typeof preparePersonalHomeDataErase>[0],
  filesystem: PersonalHomeEraseFilesystem = defaultFilesystem,
): Promise<PersonalHomeEraseResult> {
  return (await preparePersonalHomeDataErase(params, filesystem))();
}
