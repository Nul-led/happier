import { lstat, readdir, rm } from 'node:fs/promises';
import { isAbsolute, parse, resolve } from 'node:path';

import { assertLayoutPath, type PersonalHomeRuntimeLayout } from './layout.js';
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
  outcome: 'completed' | 'partial';
  removedPaths: readonly string[];
  remainingOwnedPaths: readonly string[];
  remainingUnknownPaths: readonly string[];
  error: string | null;
}>;

type PersonalHomeEraseFilesystem = Readonly<{
  lstat: typeof lstat;
  readdir: typeof readdir;
  rm: typeof rm;
}>;

const defaultFilesystem: PersonalHomeEraseFilesystem = { lstat, readdir, rm };
export function resolvePersonalHomeEraseTargets(layout: PersonalHomeRuntimeLayout): readonly string[] {
  const dataRoot = resolve(layout.dataDir);
  return [...new Set([
    layout.databasePath, `${layout.databasePath}-wal`, `${layout.databasePath}-shm`, layout.publicFilesDir,
    layout.privateFilesDir, layout.masterSecretPath, layout.backupsDir, layout.derivedDataDir,
    layout.irohEndpointKeyPath, resolve(dataRoot, '.operations', 'restore-journal.json'),
    resolve(dataRoot, '.operations', 'relocation-source.json'), resolve(dataRoot, '.operations', 'relocation-destination.json'),
    resolve(layout.configDir, 'server.env'),
  ].map((path) => resolve(path)))];
}

function resolveValidatedDataRoot(layout: PersonalHomeRuntimeLayout): string {
  const dataRoot = assertLayoutPath(layout, layout.dataDir);
  if (!isAbsolute(dataRoot) || dataRoot === parse(dataRoot).root) {
    throw new PersonalHomeEraseError('unsafe_data_root', 'Refusing to erase an unsafe Personal Home data root.');
  }
  return dataRoot;
}

export async function erasePersonalHomeData(params: Readonly<{
  layout: PersonalHomeRuntimeLayout;
  operationLeaseHeld: true;
  operation?: 'erase' | 'relocate';
}>, filesystem: PersonalHomeEraseFilesystem = defaultFilesystem): Promise<PersonalHomeEraseResult> {
  const dataRoot = resolveValidatedDataRoot(params.layout);
  if (!(await isPersonalHomeOperationLockHeld(dataRoot, params.operation ?? 'erase'))) {
    throw new PersonalHomeEraseError('unsafe_data_root', 'Personal Home erase requires the facade operation lease.');
  }
  const targets = resolvePersonalHomeEraseTargets(params.layout)
    .filter((target) => target !== resolve(dataRoot, '.operations', 'lock'));
  const existingTargets: string[] = [];
  for (const target of targets) {
    const info = await filesystem.lstat(target).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!info) continue;
    if (info.isSymbolicLink()) throw new PersonalHomeEraseError('unsafe_data_root', `Refusing to erase symbolic-link Home target: ${target}`);
    existingTargets.push(target);
  }

  const ownedTargetSet = new Set(targets);
  const readRemainingUnknownPaths = async (): Promise<readonly string[]> => (await filesystem.readdir(dataRoot).catch(
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error),
  ))
    .filter((name) => name !== '.operations' && name !== 'runtime')
    .map((name) => resolve(dataRoot, name))
    .filter((path) => !ownedTargetSet.has(path));

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
        error: `Failed to remove Personal Home target ${target}: ${detail}${unknownInspectionError
          ? `; remaining unknown-path inspection also failed: ${unknownInspectionError}`
          : ''}`,
      };
    }
  }
  const remainingUnknownPaths = await readRemainingUnknownPaths();
  await filesystem.lstat(resolve(dataRoot, '.operations', 'lock'));
  return { outcome: 'completed', removedPaths, remainingOwnedPaths: [], remainingUnknownPaths, error: null };
}
