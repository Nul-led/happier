/** @moduleRealm daemon */
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createWindowsProtectedAclBoundarySync,
  type WindowsProtectedAclBoundarySync,
} from '@happier-dev/cli-common/fs/windowsProtectedAcl';

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

export type SecureTempTextFileInputV1 = Readonly<{
  prefix: string;
  suffix?: string;
  contents: string;
  tmpDir?: string | null;
}>;

export type SecureTempDirectoryInputV1 = Readonly<{
  prefix: string;
  tmpDir?: string | null;
}>;

export type SecureTempDirectoryV1 = Readonly<{
  path: string;
  cleanup(): void;
}>;

type SecureTempTextFileDeps = Readonly<{
  platform?: NodeJS.Platform;
  windowsAclBoundary?: WindowsProtectedAclBoundarySync;
}>;

let defaultWindowsAclBoundary: WindowsProtectedAclBoundarySync | null = null;

function validatePathToken(value: string, field: 'prefix' | 'suffix'): void {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw new Error(`Invalid temporary file ${field}`);
  }
}

function bestEffortChmod(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Some platforms/filesystems do not fully support POSIX modes.
  }
}

export function createSecureTempDirectorySyncWithDeps(
  input: SecureTempDirectoryInputV1,
  deps: SecureTempTextFileDeps = {},
): SecureTempDirectoryV1 {
  validatePathToken(input.prefix, 'prefix');
  const baseDir = input.tmpDir ?? tmpdir();
  mkdirSync(baseDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  const directory = mkdtempSync(join(baseDir, `${input.prefix}-`));
  try {
    const platform = deps.platform ?? process.platform;
    if (platform === 'win32') {
      const windowsAclBoundary = deps.windowsAclBoundary
        ?? (defaultWindowsAclBoundary ??= createWindowsProtectedAclBoundarySync());
      windowsAclBoundary.applyAndVerify({ path: directory, kind: 'directory' });
    } else {
      bestEffortChmod(directory, PRIVATE_DIR_MODE);
    }
    return {
      path: directory,
      cleanup() {
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function createSecureTempDirectorySync(
  input: SecureTempDirectoryInputV1,
): SecureTempDirectoryV1 {
  return createSecureTempDirectorySyncWithDeps(input);
}

export function writeSecureTempTextFileSyncWithDeps(
  input: SecureTempTextFileInputV1,
  deps: SecureTempTextFileDeps = {},
): string {
  validatePathToken(input.prefix, 'prefix');
  if (input.suffix !== undefined && input.suffix !== '') {
    validatePathToken(input.suffix, 'suffix');
  }

  const tempDirectory = createSecureTempDirectorySyncWithDeps({
    prefix: input.prefix,
    ...(input.tmpDir === undefined ? {} : { tmpDir: input.tmpDir }),
  }, deps);
  const directory = tempDirectory.path;
  const platform = deps.platform ?? process.platform;
  const path = join(directory, `payload${input.suffix ?? ''}`);
  let fileDescriptor: number | null = null;
  try {
    if (platform !== 'win32') {
      writeFileSync(path, input.contents, { encoding: 'utf8', mode: PRIVATE_FILE_MODE, flag: 'wx' });
      bestEffortChmod(path, PRIVATE_FILE_MODE);
      return path;
    }

    const windowsAclBoundary = deps.windowsAclBoundary
      ?? (defaultWindowsAclBoundary ??= createWindowsProtectedAclBoundarySync());
    windowsAclBoundary.applyAndVerify({ path: directory, kind: 'directory' });
    fileDescriptor = openSync(path, 'wx', PRIVATE_FILE_MODE);
    // Apply and verify the restrictive DACL while the file is still empty.
    windowsAclBoundary.applyAndVerify({ path, kind: 'file' });
    writeFileSync(fileDescriptor, input.contents, { encoding: 'utf8' });
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = null;
    windowsAclBoundary.verify({ path, kind: 'file' });
    return path;
  } catch (error) {
    if (fileDescriptor !== null) {
      try {
        closeSync(fileDescriptor);
      } catch {
        // Preserve the original ACL/write failure.
      }
    }
    tempDirectory.cleanup();
    throw error;
  }
}

export function writeSecureTempTextFileSync(input: SecureTempTextFileInputV1): string {
  return writeSecureTempTextFileSyncWithDeps(input);
}
