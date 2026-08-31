import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import {
  WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES,
  type ReadWorkspaceSyncFileResultV1,
} from '@happier-dev/protocol';
import { isCanonicalAbsolutePathInsideRoot } from '@/utils/path/expandHomeDirPath';

export type ReadWorkspaceSyncFileAtRootInput = Readonly<{
  rootPath: string;
  relativePath: string;
  expectedDigest?: string;
  maxBytes: number;
}>;

function unsafePath(message: string): Error {
  return Object.assign(new Error(message), { code: 'workspace_root_unsafe' });
}

function isMissing(error: unknown): boolean {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function validateRelativePath(value: string): string {
  const trimmed = value.trim();
  const pathParts = trimmed.split(/[\\/]+/u);
  if (
    !trimmed
    || isAbsolute(trimmed)
    || win32.isAbsolute(trimmed)
    || pathParts.some((part) => part === '..')
  ) {
    throw unsafePath('workspace file path must be root-relative');
  }
  return trimmed;
}

function validateMaxBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > WORKSPACE_SYNC_FILE_PREVIEW_MAX_BYTES) {
    throw Object.assign(new Error('workspace file preview byte limit is invalid'), {
      code: 'invalid_request',
    });
  }
  return value;
}

export async function readWorkspaceSyncFileAtRoot(
  input: ReadWorkspaceSyncFileAtRootInput,
): Promise<ReadWorkspaceSyncFileResultV1> {
  const relativePath = validateRelativePath(input.relativePath);
  const maxBytes = validateMaxBytes(input.maxBytes);
  const canonicalRoot = await realpath(resolve(input.rootPath)).catch(() => {
    throw unsafePath('workspace root is unavailable');
  });
  const candidate = resolve(canonicalRoot, relativePath);
  const candidateRelative = relative(canonicalRoot, candidate);
  if (
    candidateRelative === ''
    || candidateRelative === '..'
    || candidateRelative.startsWith(`..${sep}`)
    || isAbsolute(candidateRelative)
    || !isCanonicalAbsolutePathInsideRoot(canonicalRoot, candidate)
  ) {
    throw unsafePath('workspace file path escapes or identifies the workspace root');
  }

  const entry = await lstat(candidate).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (!entry) return { status: 'missing' };
  if (entry.isSymbolicLink()) throw unsafePath('workspace file preview does not follow symlinks');

  const canonicalCandidate = await realpath(candidate).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (!canonicalCandidate) return { status: 'missing' };
  if (!isCanonicalAbsolutePathInsideRoot(canonicalRoot, canonicalCandidate)) {
    throw unsafePath('workspace file resolves outside its root');
  }

  const handle = await open(canonicalCandidate, 'r').catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (!handle) return { status: 'missing' };
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw Object.assign(new Error('workspace conflict entry is not a file'), {
        code: 'workspace_file_unsupported',
      });
    }
    if (before.size > maxBytes && input.expectedDigest === undefined) {
      return { status: 'too_large', size: before.size };
    }

    const hash = createHash('sha1');
    const retained: Buffer[] = [];
    let retainedBytes = 0;
    let offset = 0;
    const chunk = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, offset);
      if (bytesRead === 0) break;
      const bytes = chunk.subarray(0, bytesRead);
      hash.update(bytes);
      if (retainedBytes <= maxBytes) {
        const remaining = maxBytes + 1 - retainedBytes;
        if (remaining > 0) {
          const retainedChunk = Buffer.from(bytes.subarray(0, remaining));
          retained.push(retainedChunk);
          retainedBytes += retainedChunk.byteLength;
        }
      }
      offset += bytesRead;
    }
    const after = await handle.stat();
    const digest = hash.digest('hex');
    if (
      after.size !== before.size
      || after.mtimeMs !== before.mtimeMs
      || after.ino !== before.ino
      || after.dev !== before.dev
      || (input.expectedDigest !== undefined && digest !== input.expectedDigest)
    ) {
      return { status: 'changed', actualDigest: digest };
    }
    if (offset > maxBytes) {
      return { status: 'too_large', size: offset, digest };
    }

    const bytes = Buffer.concat(retained, offset);
    if (bytes.includes(0)) return { status: 'binary', digest, size: offset };
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return { status: 'text', text, digest, size: offset };
    } catch {
      return { status: 'binary', digest, size: offset };
    }
  } finally {
    await handle.close();
  }
}
