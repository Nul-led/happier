import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createRealGitScmBackendRuntimeServices, runWithGitScmCommandRunner, runWithRealGitScmRuntime } from '../testkit/scmRuntime.test-support.js';
import type { ScmBackendContext } from '../types.js';
import { gitChangeDiscard } from './changeDiscard.js';
import { gitCommitCreate } from './commitOperations.js';

function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createWorkspace(initialCommit = true) {
    const cwd = mkdtempSync(join(tmpdir(), 'happier-git-safety-'));
    git(cwd, ['init', '-q']);
    git(cwd, ['config', 'user.email', 'test@example.com']);
    git(cwd, ['config', 'user.name', 'Happier Test']);
    writeFileSync(join(cwd, 'a.txt'), 'base\n');
    if (initialCommit) {
        git(cwd, ['add', 'a.txt']);
        git(cwd, ['commit', '-qm', 'base']);
    }
    const context: ScmBackendContext = {
        cwd, projectKey: 'test', detection: { isRepo: true, rootPath: cwd, mode: '.git' },
    };
    return { cwd, context };
}

describe('Git mutation safety', () => {
    it.skipIf(process.platform === 'win32').each([false, true])('synchronizes Git-derived colon filenames (nested=%s)', async (nested) => {
        const { cwd, context } = createWorkspace();
        try {
            const commandCwd = nested ? join(cwd, 'sub') : cwd;
            if (nested) mkdirSync(commandCwd);
            writeFileSync(join(commandCwd, ':(literal)new.txt'), 'new\n');
            const response = await runWithRealGitScmRuntime(() => gitCommitCreate({
                context: { ...context, cwd: commandCwd },
                request: { message: 'colon file', scope: { kind: 'all-pending' } },
            }));
            expect(response.success).toBe(true);
            expect(git(cwd, ['status', '--porcelain'])).toBe('');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('discards only the requested bracket filename', async () => {
        const { cwd, context } = createWorkspace();
        try {
            writeFileSync(join(cwd, 'literal[1].txt'), 'chosen\n');
            writeFileSync(join(cwd, 'literal1.txt'), 'keep\n');
            const response = await runWithRealGitScmRuntime(() => gitChangeDiscard({
                context, request: { entries: [{ path: 'literal[1].txt', kind: 'untracked' }] },
            }));
            expect(response.success).toBe(true);
            expect(existsSync(join(cwd, 'literal[1].txt'))).toBe(false);
            expect(readFileSync(join(cwd, 'literal1.txt'), 'utf8')).toBe('keep\n');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    it.each(['paths', 'all-pending'] as const)('synchronizes the live index after a %s root commit', async (kind) => {
        const { cwd, context } = createWorkspace(false);
        try {
            const response = await runWithRealGitScmRuntime(() => gitCommitCreate({
                context, request: { message: 'root', scope: kind === 'paths' ? { kind, include: ['a.txt'] } : { kind } },
            }));
            expect(response.success).toBe(true);
            expect(git(cwd, ['show', 'HEAD:a.txt'])).toBe('base');
            expect(git(cwd, ['status', '--porcelain'])).toBe('');
            expect(git(cwd, ['diff', '--cached', '--name-only'])).toBe('');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('preserves same-path and unrelated staging when the preservation inspection fails', async () => {
        const { cwd, context } = createWorkspace();
        try {
            writeFileSync(join(cwd, 'a.txt'), 'staged\n');
            writeFileSync(join(cwd, 'b.txt'), 'unrelated\n');
            git(cwd, ['add', 'a.txt', 'b.txt']);
            writeFileSync(join(cwd, 'a.txt'), 'pending\n');
            const head = git(cwd, ['rev-parse', 'HEAD']);
            const index = readFileSync(join(cwd, '.git', 'index'));
            const runtime = createRealGitScmBackendRuntimeServices();
            // Inject only at the Git process boundary; every other command uses real Git.
            const response = await runWithGitScmCommandRunner((input) =>
                input.args.join(' ') === 'diff --cached --name-status -z'
                    ? Promise.resolve({ success: false, stdout: '', stderr: 'inspection failed', exitCode: 128 })
                    : runtime.runCommand(input), () => gitCommitCreate({
                context,
                request: { message: 'must not commit', scope: { kind: 'paths', include: ['a.txt'] } },
            }));
            expect(response.success).toBe(false);
            expect(git(cwd, ['rev-parse', 'HEAD'])).toBe(head);
            expect(readFileSync(join(cwd, '.git', 'index'))).toEqual(index);
            expect(readFileSync(join(cwd, 'a.txt'), 'utf8')).toBe('pending\n');
            expect(readFileSync(join(cwd, 'b.txt'), 'utf8')).toBe('unrelated\n');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    it.each(['untracked', 'added', 'locked'] as const)('reports actual discard outcome for %s files', async (kind) => {
        const { cwd, context } = createWorkspace();
        try {
            writeFileSync(join(cwd, 'new.txt'), 'new\n');
            if (kind !== 'untracked') git(cwd, ['add', 'new.txt']);
            const index = readFileSync(join(cwd, '.git', 'index'));
            if (kind === 'locked') writeFileSync(join(cwd, '.git', 'index.lock'), '');
            const response = await runWithRealGitScmRuntime(() => gitChangeDiscard({
                context,
                request: { entries: [{ path: 'new.txt', kind: kind === 'untracked' ? 'untracked' : 'added' }] },
            }));
            expect(response.success).toBe(kind !== 'locked');
            expect(existsSync(join(cwd, 'new.txt'))).toBe(kind === 'locked');
            if (kind === 'locked') expect(readFileSync(join(cwd, '.git', 'index'))).toEqual(index);
            else expect(git(cwd, ['status', '--porcelain'])).toBe('');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});
