import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { runWithRealGitScmRuntime } from '../testkit/scmRuntime.test-support.js';
import { resolveGitWorkspaceTransferEntries } from './resolveGitWorkspaceTransferEntries.js';

const execFile = promisify(execFileCallback);

async function makeTempDir(prefix: string): Promise<string> {
    return await mkdtemp(join(tmpdir(), prefix));
}

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
    const { stdout } = await execFile('git', [...args], { cwd });
    return stdout.trim();
}

async function configureGitRepo(cwd: string): Promise<void> {
    await runGit(cwd, ['config', 'user.email', 'test@example.com']);
    await runGit(cwd, ['config', 'user.name', 'Happier Test']);
}

async function withHostScmRuntime<T>(callback: () => Promise<T>): Promise<T> {
    return await runWithRealGitScmRuntime(callback);
}

describe('resolveGitWorkspaceTransferEntries', () => {
    it('never exports checkout administration from a primary checkout', async () => {
        const repoRoot = await makeTempDir('git-transfer-primary-');

        try {
            await runGit(repoRoot, ['init']);
            await configureGitRepo(repoRoot);
            await writeFile(join(repoRoot, 'README.md'), 'hello\n', 'utf8');
            await runGit(repoRoot, ['add', 'README.md']);
            await runGit(repoRoot, ['commit', '-m', 'initial']);

            const entries = await withHostScmRuntime(async () => await resolveGitWorkspaceTransferEntries({
                context: {
                    cwd: repoRoot,
                    projectKey: `test:${repoRoot}`,
                    detection: {
                        isRepo: true,
                        rootPath: repoRoot,
                        mode: '.git',
                    },
                },
                workspaceTransfer: {
                    strategy: 'transfer_snapshot',
                    includeIgnoredMode: 'exclude',
                    ignoredIncludeGlobs: [],
                },
            }));

            expect(entries).toEqual(expect.arrayContaining([
                expect.objectContaining({ relativePath: 'README.md' }),
            ]));
            expect(entries.some((entry) => entry.relativePath === '.git/config')).toBe(false);
            expect(entries.some((entry) => entry.relativePath.startsWith('.git/'))).toBe(false);
        } finally {
            await rm(repoRoot, { recursive: true, force: true });
        }
    });

    it('omits all checkout administration when a primary checkout owns linked worktrees', async () => {
        const repoRoot = await makeTempDir('git-transfer-primary-linked-admin-repo-');
        const worktreeRoot = await makeTempDir('git-transfer-primary-linked-admin-worktree-');

        try {
            await runGit(repoRoot, ['init']);
            await configureGitRepo(repoRoot);
            await writeFile(join(repoRoot, 'README.md'), 'hello\n', 'utf8');
            await runGit(repoRoot, ['add', 'README.md']);
            await runGit(repoRoot, ['commit', '-m', 'initial']);
            await runGit(repoRoot, ['branch', 'feature']);
            await runGit(repoRoot, ['worktree', 'add', worktreeRoot, 'feature']);

            const entries = await withHostScmRuntime(async () => await resolveGitWorkspaceTransferEntries({
                context: {
                    cwd: repoRoot,
                    projectKey: `test:${repoRoot}`,
                    detection: {
                        isRepo: true,
                        rootPath: repoRoot,
                        mode: '.git',
                    },
                },
                workspaceTransfer: {
                    strategy: 'transfer_snapshot',
                    includeIgnoredMode: 'exclude',
                    ignoredIncludeGlobs: [],
                },
            }));

            expect(entries.some((entry) => entry.relativePath.startsWith('.git/'))).toBe(false);
        } finally {
            await rm(repoRoot, { recursive: true, force: true });
            await rm(worktreeRoot, { recursive: true, force: true });
        }
    }, 15_000);

    it('scopes nested workspace exports to the requested subdirectory and omits checkout metadata', async () => {
        const repoRoot = await makeTempDir('git-transfer-nested-workspace-');
        const nestedWorkspaceDir = join(repoRoot, 'apps', 'demo');

        try {
            await runGit(repoRoot, ['init']);
            await configureGitRepo(repoRoot);
            await mkdir(nestedWorkspaceDir, { recursive: true });
            await writeFile(join(repoRoot, 'README.md'), 'repo root\n', 'utf8');
            await writeFile(join(nestedWorkspaceDir, 'workspace.txt'), 'workspace\n', 'utf8');
            await runGit(repoRoot, ['add', 'README.md', 'apps/demo/workspace.txt']);
            await runGit(repoRoot, ['commit', '-m', 'initial']);

            const entries = await withHostScmRuntime(async () => await resolveGitWorkspaceTransferEntries({
                context: {
                    cwd: nestedWorkspaceDir,
                    projectKey: `test:${nestedWorkspaceDir}`,
                    detection: {
                        isRepo: true,
                        rootPath: repoRoot,
                        mode: '.git',
                    },
                },
                workspaceTransfer: {
                    strategy: 'transfer_snapshot',
                    includeIgnoredMode: 'exclude',
                    ignoredIncludeGlobs: [],
                },
            }));

            expect(entries).toEqual([
                expect.objectContaining({ relativePath: 'workspace.txt' }),
            ]);
            expect(entries.some((entry) => entry.relativePath.startsWith('.git/'))).toBe(false);
            expect(entries.some((entry) => entry.relativePath === 'README.md')).toBe(false);
        } finally {
            await rm(repoRoot, { recursive: true, force: true });
        }
    });

    it('omits non-portable linked-worktree admin metadata', async () => {
        const repoRoot = await makeTempDir('git-transfer-linked-repo-');
        const worktreeRoot = await makeTempDir('git-transfer-linked-worktree-');

        try {
            await runGit(repoRoot, ['init']);
            await configureGitRepo(repoRoot);
            await writeFile(join(repoRoot, 'README.md'), 'hello\n', 'utf8');
            await runGit(repoRoot, ['add', 'README.md']);
            await runGit(repoRoot, ['commit', '-m', 'initial']);
            await runGit(repoRoot, ['branch', 'feature']);
            await runGit(repoRoot, ['worktree', 'add', worktreeRoot, 'feature']);

            const entries = await withHostScmRuntime(async () => await resolveGitWorkspaceTransferEntries({
                context: {
                    cwd: worktreeRoot,
                    projectKey: `test:${worktreeRoot}`,
                    detection: {
                        isRepo: true,
                        rootPath: repoRoot,
                        mode: '.git',
                    },
                },
                workspaceTransfer: {
                    strategy: 'transfer_snapshot',
                    includeIgnoredMode: 'exclude',
                    ignoredIncludeGlobs: [],
                },
            }));

            expect(entries).toEqual(expect.arrayContaining([
                expect.objectContaining({ relativePath: 'README.md' }),
            ]));
            expect(entries.some((entry) => entry.relativePath.startsWith('.git/'))).toBe(false);
        } finally {
            await rm(repoRoot, { recursive: true, force: true });
            await rm(worktreeRoot, { recursive: true, force: true });
        }
    }, 15_000);

    it('handles large git ls-files output without hitting exec maxBuffer limits', async () => {
        const repoRoot = await makeTempDir('git-transfer-large-ls-files-');

        try {
            await runGit(repoRoot, ['init']);
            await configureGitRepo(repoRoot);

            const deepDirSegment = `seg-${'x'.repeat(80)}`;
            const baseDir = join(repoRoot, deepDirSegment, deepDirSegment, deepDirSegment);
            const bucketCount = 25;
            const fileCount = 3500;

            const createdDirs = new Set<string>();
            const expectedRelativePath = join(
                deepDirSegment,
                deepDirSegment,
                deepDirSegment,
                'b0',
                `file-0000-${'y'.repeat(120)}.txt`,
            ).replace(/\\/g, '/');

            for (let index = 0; index < fileCount; index += 1) {
                const bucketDir = join(baseDir, `b${index % bucketCount}`);
                if (!createdDirs.has(bucketDir)) {
                    createdDirs.add(bucketDir);
                    await mkdir(bucketDir, { recursive: true });
                }

                const fileName = `file-${String(index).padStart(4, '0')}-${'y'.repeat(120)}.txt`;
                await writeFile(join(bucketDir, fileName), 'x', 'utf8');
            }

            const entries = await withHostScmRuntime(async () => await resolveGitWorkspaceTransferEntries({
                context: {
                    cwd: repoRoot,
                    projectKey: `test:${repoRoot}`,
                    detection: {
                        isRepo: true,
                        rootPath: repoRoot,
                        mode: '.git',
                    },
                },
                workspaceTransfer: {
                    strategy: 'transfer_snapshot',
                    includeIgnoredMode: 'exclude',
                    ignoredIncludeGlobs: [],
                },
            }));

            expect(entries.some((entry) => entry.relativePath === expectedRelativePath)).toBe(true);
        } finally {
            await rm(repoRoot, { recursive: true, force: true });
        }
    }, 15_000);
});
