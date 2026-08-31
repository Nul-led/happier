import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { registerRuntimeSecretValues } from '../../artifactSecretSafety';

const runtimeMaterialRoot = resolve(tmpdir(), 'happier-stress-compose-runtime');

export type PrivateComposeRuntimeMaterial = Readonly<{
  dir: string;
  composeFile: string;
  secretValuesFile: string;
}>;

export function createPrivateComposeRuntimeMaterial(params: Readonly<{
  composeProjectName: string;
  composeYaml: string;
  secretValues?: readonly string[];
}>): PrivateComposeRuntimeMaterial {
  mkdirSync(runtimeMaterialRoot, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') chmodSync(runtimeMaterialRoot, 0o700);
  const safeProjectName = params.composeProjectName.replace(/[^a-zA-Z0-9-]+/gu, '-').slice(0, 80);
  const dir = mkdtempSync(join(runtimeMaterialRoot, `${safeProjectName || 'compose'}-`));
  if (process.platform !== 'win32') chmodSync(dir, 0o700);
  const composeFile = join(dir, 'docker-compose.yml');
  const secretValuesFile = join(dir, 'runtime-secret-values.json');
  writeFileSync(composeFile, params.composeYaml, { encoding: 'utf8', mode: 0o600 });
  writeFileSync(
    secretValuesFile,
    `${JSON.stringify(params.secretValues ?? [])}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  if (process.platform !== 'win32') chmodSync(composeFile, 0o600);
  if (process.platform !== 'win32') chmodSync(secretValuesFile, 0o600);
  return { dir, composeFile, secretValuesFile };
}

export function registerPrivateComposeRuntimeSecretValues(composeFile: string): void {
  if (!isPrivateComposeRuntimePath(composeFile)) {
    throw new Error('Invalid private compose runtime material path');
  }
  const secretValuesFile = join(dirname(composeFile), 'runtime-secret-values.json');
  if (!existsSync(secretValuesFile)) {
    throw new Error('Private compose runtime secret values are missing');
  }
  const values: unknown = JSON.parse(readFileSync(secretValuesFile, 'utf8'));
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new Error('Private compose runtime secret values are invalid');
  }
  registerRuntimeSecretValues(...values);
}

export function isPrivateComposeRuntimePath(path: string | undefined): boolean {
  if (!path) return false;
  const resolvedPath = resolve(path);
  return basename(resolvedPath) === 'docker-compose.yml'
    && dirname(dirname(resolvedPath)) === runtimeMaterialRoot;
}

export function deletePrivateComposeRuntimeMaterial(composeFile: string | undefined): void {
  if (!composeFile || !isPrivateComposeRuntimePath(composeFile)) return;
  const dir = dirname(resolve(composeFile));
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
