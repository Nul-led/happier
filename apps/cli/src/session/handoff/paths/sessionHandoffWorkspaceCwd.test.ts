import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ensureSessionHandoffWorkspaceCwd } from './sessionHandoffWorkspaceCwd';

describe('ensureSessionHandoffWorkspaceCwd', () => {
    it('creates an empty contained nested cwd after repository materialization', async () => {
        const root = await mkdtemp(join(tmpdir(), 'handoff-workspace-root-'));
        try {
            const target = join(root, 'packages', 'empty');
            await expect(ensureSessionHandoffWorkspaceCwd({
                workspaceRootPath: root,
                sessionRelativeCwd: 'packages/empty',
                targetPath: target,
            })).resolves.toBe(target);
            await writeFile(join(target, 'proof.txt'), 'created');
            await expect(readFile(join(target, 'proof.txt'), 'utf8')).resolves.toBe('created');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('rejects a symlink escape without writing outside the repository root', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'handoff-workspace-escape-'));
        const root = join(fixture, 'root');
        const outside = join(fixture, 'outside');
        await Promise.all([mkdir(root), mkdir(outside)]);
        await symlink(outside, join(root, 'packages'), 'dir');
        try {
            await expect(ensureSessionHandoffWorkspaceCwd({
                workspaceRootPath: root,
                sessionRelativeCwd: 'packages/empty',
                targetPath: join(root, 'packages', 'empty'),
            })).rejects.toMatchObject({ code: 'workspace_root_unsafe' });
            await expect(lstat(join(outside, 'empty'))).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });
});
