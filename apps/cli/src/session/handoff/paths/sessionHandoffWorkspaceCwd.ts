import { lstat, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { getPathRemainderWithinBase, resolveSessionHandoffWorkspaceSessionPath } from './sessionHandoffPathNormalization';

function unsafe(message: string): Error {
    return Object.assign(new Error(message), { code: 'workspace_root_unsafe' });
}

/** Validates and, when absent, creates only the contained post-materialization session cwd. */
export async function ensureSessionHandoffWorkspaceCwd(input: Readonly<{
    workspaceRootPath: string;
    sessionRelativeCwd: string;
    targetPath: string;
}>): Promise<string> {
    const expectedTarget = resolveSessionHandoffWorkspaceSessionPath({
        targetRoot: input.workspaceRootPath,
        sessionRelativeCwd: input.sessionRelativeCwd,
    });
    if (expectedTarget !== input.targetPath) {
        throw unsafe('Session handoff target path does not match its repository-relative cwd');
    }
    const canonicalRoot = await realpath(input.workspaceRootPath).catch(() => null);
    if (!canonicalRoot || !(await lstat(canonicalRoot).catch(() => null))?.isDirectory()) {
        throw unsafe('Session handoff repository root is unavailable');
    }
    const segments = input.sessionRelativeCwd.replace(/\\/g, '/').split('/').filter(Boolean);
    let current = canonicalRoot;
    for (const segment of segments) {
        current = join(current, segment);
        const existing = await lstat(current).catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw error;
        });
        if (!existing) await mkdir(current);
        const observed = await lstat(current);
        if (!observed.isDirectory() || observed.isSymbolicLink()) {
            throw unsafe('Session handoff cwd contains a symlink or non-directory component');
        }
        const canonicalCurrent = await realpath(current);
        if (getPathRemainderWithinBase(canonicalCurrent, canonicalRoot) === null) {
            throw unsafe('Session handoff cwd escapes its repository root');
        }
    }
    return current;
}
