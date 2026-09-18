import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type ConfinedWorkspaceSyncParent = Readonly<{
  parentHandlePath: string;
  finalName: string;
}>;

function unsafe(message: string): Error {
  return Object.assign(new Error(message), { code: 'workspace_root_unsafe' });
}

function validateRelativePath(value: string): readonly string[] {
  const parts = value.split('/');
  if (!value || value.includes('\0') || isAbsolute(value)
    || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw unsafe('workspace path must identify a root-relative descendant');
  }
  return parts;
}

function descriptorRoot(fd: number): string {
  return `/proc/self/fd/${fd}`;
}

function assertDescendant(canonicalRoot: string, candidate: string): void {
  const rest = relative(canonicalRoot, candidate);
  if (!rest || rest === '..' || rest.startsWith(`..${sep}`) || isAbsolute(rest)) {
    throw unsafe('workspace path escapes or identifies its root');
  }
}

/**
 * Linux retains every directory from the canonical workspace root to the
 * final entry's parent and dereferences descendants through those handles.
 * Darwin and Windows operations use the packaged native two-phase helper at
 * their read/delete owners because neither platform exposes this Linux
 * descriptor namespace to Node.
 */
export async function withConfinedWorkspaceSyncParent<T>(input: Readonly<{
  rootPath: string;
  relativePath: string;
  assertCurrentAuthority?: () => Promise<void>;
  run(parent: ConfinedWorkspaceSyncParent): Promise<T>;
}>): Promise<T> {
  const parts = validateRelativePath(input.relativePath);
  if (process.platform === 'win32') {
    // Node does not expose handle-relative descendant traversal or mutation on
    // Windows, so pathname-based callers cannot preserve root confinement.
    throw unsafe('workspace filesystem operation requires handle confinement on Windows');
  }
  const canonicalRoot = await realpath(resolve(input.rootPath)).catch(() => {
    throw unsafe('workspace root is unavailable');
  });
  const requested = resolve(canonicalRoot, ...parts);
  assertDescendant(canonicalRoot, requested);
  if (process.platform !== 'linux') {
    throw unsafe(`workspace filesystem confinement is unavailable on ${process.platform}`);
  }

  const handles = [] as Awaited<ReturnType<typeof open>>[];
  try {
    let handle = await open(canonicalRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      .catch(() => { throw unsafe('workspace root changed during confinement'); });
    handles.push(handle);
    for (const component of parts.slice(0, -1)) {
      handle = await open(
        resolve(descriptorRoot(handle.fd), component),
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      ).catch(() => { throw unsafe('workspace path parent changed during confinement'); });
      handles.push(handle);
    }
    await input.assertCurrentAuthority?.();
    return await input.run({
      parentHandlePath: descriptorRoot(handle.fd),
      finalName: parts.at(-1)!,
    });
  } finally {
    await Promise.all(handles.reverse().map(async (handle) => await handle.close().catch(() => undefined)));
  }
}
