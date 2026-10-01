import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ScmStashCreateResponseSchema } from '@happier-dev/protocol';

import { runWithRealGitScmRuntime } from '../testkit/scmRuntime.test-support.js';
import type { ScmBackendContext } from '../types.js';
import { gitStashCreate, gitStashList } from './stashOperations.js';

const execFile = promisify(execFileCallback);
async function git(cwd: string, ...args: string[]): Promise<string> {
    return (await execFile('git', args, { cwd })).stdout.trim();
}

describe('gitStashCreate', () => {
    it('keeps untracked changes as a named transient stash on the current branch', async () => {
        const cwd = await mkdtemp(join(tmpdir(), 'happier-stash-create-'));
        try {
            await git(cwd, 'init');
            await git(cwd, 'config', 'user.email', 'test@example.com');
            await git(cwd, 'config', 'user.name', 'Test User');
            await writeFile(join(cwd, 'base.txt'), 'base\n');
            await git(cwd, 'add', 'base.txt');
            await git(cwd, 'commit', '-m', 'base');
            const branch = await git(cwd, 'branch', '--show-current');
            await writeFile(join(cwd, 'kept.txt'), 'kept\n');
            const context: ScmBackendContext = {
                cwd, projectKey: `test:${cwd}`, detection: { isRepo: true, rootPath: cwd, mode: '.git' },
            };
            const created = await runWithRealGitScmRuntime(() => gitStashCreate({ context, request: { cwd, message: 'Keep these changes' } }));
            expect(created).toMatchObject({ success: true, stashCreated: true });
            expect(created.stashRef).toMatch(/^stash@\{\d+\}$/);
            expect(await git(cwd, 'status', '--porcelain')).toBe('');
            const listed = await runWithRealGitScmRuntime(() => gitStashList({ context, request: { cwd } }));
            expect(listed.stashes).toEqual(expect.arrayContaining([
                expect.objectContaining({ stashRef: created.stashRef, kind: 'transient', branch }),
            ]));
            const noChanges = await runWithRealGitScmRuntime(() => gitStashCreate({ context, request: { cwd, message: 'Nothing new' } }));
            expect(noChanges).toMatchObject({ success: true, stashCreated: false, stashRef: null });
            expect(ScmStashCreateResponseSchema.safeParse(noChanges).success).toBe(true);
            expect(noChanges.stashOid).toBeUndefined();
            const after = await runWithRealGitScmRuntime(() => gitStashList({ context, request: { cwd } }));
            expect(after.totalCount).toBe(1);
        } finally {
            await rm(cwd, { recursive: true, force: true });
        }
    });
});
