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
  removedPaths: readonly string[];
  remainingUnknownPaths: readonly string[];
}>;
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
}>): Promise<PersonalHomeEraseResult> {
  const dataRoot = resolveValidatedDataRoot(params.layout);
  if (!(await isPersonalHomeOperationLockHeld(dataRoot, params.operation ?? 'erase'))) {
    throw new PersonalHomeEraseError('unsafe_data_root', 'Personal Home erase requires the facade operation lease.');
  }
  const removedPaths: string[] = [];
  for (const target of resolvePersonalHomeEraseTargets(params.layout)) {
    if (target === resolve(dataRoot, '.operations', 'lock')) continue;
    const info = await lstat(target).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!info) continue;
    if (info.isSymbolicLink()) throw new PersonalHomeEraseError('unsafe_data_root', `Refusing to erase symbolic-link Home target: ${target}`);
    await rm(target, { recursive: true, force: true });
    await lstat(target).then(
      () => { throw new PersonalHomeEraseError('unsafe_data_root', `Personal Home erase postcondition failed: ${target}`); },
      (error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; },
    );
    removedPaths.push(target);
  }
  const remainingUnknownPaths = (await readdir(dataRoot).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error)))
    .filter((name) => name !== '.operations' && name !== 'runtime')
    .map((name) => resolve(dataRoot, name));
  await lstat(resolve(dataRoot, '.operations', 'lock'));
  return { removedPaths, remainingUnknownPaths };
}
