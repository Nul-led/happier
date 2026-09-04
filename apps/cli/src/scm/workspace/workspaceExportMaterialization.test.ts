import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createScmBackendRegistry } from '@/scm/registry';
import { readWorkspaceSyncRootObjectIdentity } from '@/workspaces/sync/workspaceSyncRootIdentity';
import { buildScmWorkspaceIntegrationWorkspaceExportArtifactsWithBlobProviderFromTransferEntries } from './workspaceExportArtifacts';
import {
    beginWorkspaceTargetMaterialization,
    materializeWorkspaceExportArtifactsWithScmWorkspace,
    recoverInterruptedWorkspaceTargetMaterialization,
    rehydrateWorkspaceTargetMaterialization,
    type WorkspaceTargetMaterializationReceiptV1,
} from './workspaceExportMaterialization';

const childFixturePath = join(dirname(fileURLToPath(import.meta.url)), 'workspaceExportMaterialization.child.ts');

async function waitForFile(path: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (!(await access(path).then(() => true, () => false))) {
        if (Date.now() >= deadline) throw new Error(`timed out waiting for ${path}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

const naming = {
    siblingCopySuffixBase: 'copy',
    backupDirectoryPrefix: '.backup',
    stagingIdPrefix: 'staging',
} as const;
const registry = createScmBackendRegistry([]);
describe('workspace export materialization custody', () => {
    it('rejects an old partial receipt without touching either pathname', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-partial-receipt-'));
        try {
            const target = join(fixture, 'target');
            const backup = join(fixture, '.backup.00000000-0000-4000-8000-000000000000');
            await mkdir(target);
            await mkdir(backup);
            await writeFile(join(target, 'target.txt'), 'target');
            await writeFile(join(backup, 'backup.txt'), 'backup');

            await expect(rehydrateWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receipt: { v: 1, previousTargetName: '.backup.00000000-0000-4000-8000-000000000000' } as WorkspaceTargetMaterializationReceiptV1,
            })).rejects.toMatchObject({ code: 'workspace_target_materialization_manual_recovery' });
            await expect(readFile(join(target, 'target.txt'), 'utf8')).resolves.toBe('target');
            await expect(readFile(join(backup, 'backup.txt'), 'utf8')).resolves.toBe('backup');
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('preserves both pathnames when receipt identity proof is unavailable', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-identity-unavailable-'));
        try {
            const target = join(fixture, 'target');
            const backupName = '.backup.00000000-0000-4000-8000-000000000000';
            const backup = join(fixture, backupName);
            await mkdir(target);
            await mkdir(backup);
            await writeFile(join(target, 'target.txt'), 'target');
            await writeFile(join(backup, 'backup.txt'), 'backup');

            await expect(rehydrateWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receipt: {
                    v: 1,
                    previousTargetName: backupName,
                    originalTargetIdentity: null,
                    promotedTargetIdentity: null,
                    expectedBackupIdentity: null,
                },
            })).rejects.toMatchObject({ code: 'workspace_target_materialization_manual_recovery' });
            await expect(readFile(join(target, 'target.txt'), 'utf8')).resolves.toBe('target');
            await expect(readFile(join(backup, 'backup.txt'), 'utf8')).resolves.toBe('backup');
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('rehydrates rollback custody after the materializing process is killed', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-crash-'));
        const target = join(fixture, 'target');
        const receiptPath = join(fixture, 'receipt.json');
        await mkdir(target);
        await writeFile(join(target, 'old.txt'), 'old');
        const child = spawn(process.execPath, [
            '--import',
            'tsx',
            childFixturePath,
            target,
            receiptPath,
        ], {
            cwd: join(dirname(childFixturePath), '../../..'),
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
        try {
            await waitForFile(receiptPath);
            child.kill('SIGKILL');
            await new Promise<void>((resolve, reject) => {
                child.once('error', reject);
                child.once('exit', () => resolve());
            });
            await expect(readFile(join(target, 'new.txt'), 'utf8')).resolves.toBe('new');
            const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as WorkspaceTargetMaterializationReceiptV1;
            const recovered = await rehydrateWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receipt,
            });
            expect(recovered).not.toBeNull();
            if (!recovered) throw new Error('materialization custody was already settled');
            await recovered.abort();
            await expect(readFile(join(target, 'old.txt'), 'utf8')).resolves.toBe('old');
            await expect(readFile(join(target, 'new.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
        } catch (error) {
            throw new Error(`child-process recovery failed: ${stderr}`, { cause: error });
        } finally {
            child.kill('SIGKILL');
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('treats a missing named backup as an already-crossed commit boundary', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-committed-'));
        try {
            const target = join(fixture, 'target');
            await mkdir(target);
            await writeFile(join(target, 'old.txt'), 'old');
            const materialization = await beginWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
            });
            await mkdir(target);
            await writeFile(join(target, 'new.txt'), 'new');
            await materialization.custody.bindPromotedTarget();
            await materialization.custody.commit();

            await expect(rehydrateWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receipt: materialization.custody.receipt,
            })).resolves.toBeNull();
            await expect(readFile(join(target, 'new.txt'), 'utf8')).resolves.toBe('new');
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('rejects a receipt that names anything outside the canonical backup namespace', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-unsafe-'));
        try {
            const target = join(fixture, 'target');
            await mkdir(target);
            await writeFile(join(target, 'keep.txt'), 'keep');
            const identity = await readWorkspaceSyncRootObjectIdentity(target);
            await expect(rehydrateWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receipt: {
                    v: 1,
                    previousTargetName: '../other',
                    originalTargetIdentity: identity,
                    promotedTargetIdentity: identity,
                    expectedBackupIdentity: identity,
                },
            })).rejects.toThrow('Invalid workspace target materialization receipt');
            await expect(readFile(join(target, 'keep.txt'), 'utf8')).resolves.toBe('keep');
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('keeps a replaced target recoverable until abort restores it', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-'));
        try {
            const source = join(fixture, 'source');
            const target = join(fixture, 'target');
            await mkdir(source);
            await mkdir(target);
            await writeFile(join(source, 'new.txt'), 'new');
            await writeFile(join(target, 'old.txt'), 'old');
            const built = await buildScmWorkspaceIntegrationWorkspaceExportArtifactsWithBlobProviderFromTransferEntries({
                entries: [{ relativePath: 'new.txt', sourcePath: join(source, 'new.txt') }],
            });

            const materialized = await materializeWorkspaceExportArtifactsWithScmWorkspace({
                workspaceExportArtifacts: built.workspaceExportArtifacts,
                targetPath: target,
                conflictPolicy: 'replace_existing',
                blobProvider: built.blobProvider,
                registry,
                naming,
            });

            await expect(readFile(join(target, 'new.txt'), 'utf8')).resolves.toBe('new');
            expect((await readdir(fixture)).some((name) => name.startsWith('.backup.'))).toBe(true);
            await materialized.custody.abort();
            await expect(readFile(join(target, 'old.txt'), 'utf8')).resolves.toBe('old');
            await expect(readFile(join(target, 'new.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            expect((await readdir(fixture)).some((name) => name.startsWith('.backup.'))).toBe(false);
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('preserves an unrelated object that replaced the target before abort', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-abort-replaced-'));
        try {
            const target = join(fixture, 'target');
            await mkdir(target);
            await writeFile(join(target, 'old.txt'), 'old');
            const materialization = await beginWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
            });
            await mkdir(target);
            await writeFile(join(target, 'new.txt'), 'new');
            await materialization.custody.bindPromotedTarget();

            // A user, IDE or SCM replaces the promoted tree at the same pathname.
            await rm(target, { recursive: true, force: true });
            await mkdir(target);
            await writeFile(join(target, 'user.txt'), 'unrelated');

            await expect(materialization.custody.abort()).rejects.toMatchObject({
                code: 'workspace_target_materialization_manual_recovery',
            });
            await expect(readFile(join(target, 'user.txt'), 'utf8')).resolves.toBe('unrelated');
            expect((await readdir(fixture)).some((name) => name.startsWith('.backup.'))).toBe(true);
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('preserves an unrelated object that replaced the expected backup before commit', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-commit-backup-'));
        try {
            const target = join(fixture, 'target');
            await mkdir(target);
            await writeFile(join(target, 'old.txt'), 'old');
            const materialization = await beginWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
            });
            await mkdir(target);
            await writeFile(join(target, 'new.txt'), 'new');
            await materialization.custody.bindPromotedTarget();

            const backupName = (await readdir(fixture)).find((name) => name.startsWith('.backup.'))!;
            const backupPath = join(fixture, backupName);
            await rm(backupPath, { recursive: true, force: true });
            await mkdir(backupPath);
            await writeFile(join(backupPath, 'user.txt'), 'unrelated');

            await expect(materialization.custody.commit()).rejects.toMatchObject({
                code: 'workspace_target_materialization_manual_recovery',
            });
            await expect(readFile(join(backupPath, 'user.txt'), 'utf8')).resolves.toBe('unrelated');
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('keeps the original backup when the target was replaced before commit', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-commit-target-'));
        try {
            const target = join(fixture, 'target');
            await mkdir(target);
            await writeFile(join(target, 'old.txt'), 'old');
            const materialization = await beginWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
            });
            await mkdir(target);
            await writeFile(join(target, 'new.txt'), 'new');
            await materialization.custody.bindPromotedTarget();

            await rm(target, { recursive: true, force: true });
            await mkdir(target);
            await writeFile(join(target, 'user.txt'), 'unrelated');

            await expect(materialization.custody.commit()).rejects.toMatchObject({
                code: 'workspace_target_materialization_manual_recovery',
            });
            const backupName = (await readdir(fixture)).find((name) => name.startsWith('.backup.'))!;
            await expect(readFile(join(fixture, backupName, 'old.txt'), 'utf8')).resolves.toBe('old');
            await expect(readFile(join(target, 'user.txt'), 'utf8')).resolves.toBe('unrelated');
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('preserves a replaced target during restart recovery', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-recover-replaced-'));
        try {
            const target = join(fixture, 'target');
            const receiptPath = join(fixture, 'receipt.json');
            await mkdir(target);
            await writeFile(join(target, 'old.txt'), 'old');
            const materialization = await beginWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receiptPath,
            });
            await mkdir(target);
            await writeFile(join(target, 'new.txt'), 'new');
            await materialization.custody.bindPromotedTarget();

            await rm(target, { recursive: true, force: true });
            await mkdir(target);
            await writeFile(join(target, 'user.txt'), 'unrelated');

            await expect(recoverInterruptedWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receiptPath,
            })).rejects.toMatchObject({ code: 'workspace_target_materialization_manual_recovery' });
            await expect(readFile(join(target, 'user.txt'), 'utf8')).resolves.toBe('unrelated');
            const backupName = (await readdir(fixture)).find((name) => name.startsWith('.backup.'))!;
            await expect(readFile(join(fixture, backupName, 'old.txt'), 'utf8')).resolves.toBe('old');
            await expect(access(receiptPath)).resolves.toBeUndefined();
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('finishes rollback recovery after the backup was restored but its receipt was not yet removed', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-abort-crash-'));
        try {
            const target = join(fixture, 'target');
            const receiptPath = join(fixture, 'receipt.json');
            await mkdir(target);
            await writeFile(join(target, 'old.txt'), 'old');
            const materialization = await beginWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receiptPath,
            });
            await mkdir(target);
            await writeFile(join(target, 'new.txt'), 'new');
            await materialization.custody.bindPromotedTarget();

            await rm(target, { recursive: true, force: true });
            await rename(materialization.previousTargetPath!, target);

            await expect(recoverInterruptedWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receiptPath,
            })).resolves.toBe(true);
            await expect(readFile(join(target, 'old.txt'), 'utf8')).resolves.toBe('old');
            expect((await readdir(target)).filter((name) => name.startsWith('.happier-materialization-'))).toEqual([]);
            await expect(access(receiptPath)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('surfaces manual recovery when rollback cannot safely restore the original target', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-abort-error-'));
        try {
            const source = join(fixture, 'source');
            const target = join(fixture, 'target');
            const receiptPath = join(fixture, 'receipt.json');
            await mkdir(source);
            await mkdir(target);
            await writeFile(join(source, 'new.txt'), 'new');
            await writeFile(join(target, 'old.txt'), 'old');
            const built = await buildScmWorkspaceIntegrationWorkspaceExportArtifactsWithBlobProviderFromTransferEntries({
                entries: [{ relativePath: 'new.txt', sourcePath: join(source, 'new.txt') }],
            });
            await expect(materializeWorkspaceExportArtifactsWithScmWorkspace({
                workspaceExportArtifacts: built.workspaceExportArtifacts,
                targetPath: target,
                conflictPolicy: 'replace_existing',
                blobProvider: built.blobProvider,
                registry,
                naming,
                materializationReceiptPath: receiptPath,
                assertCanContinue: async () => {
                    const promotedTargetExists = await access(join(target, 'new.txt')).then(
                        () => true,
                        () => false,
                    );
                    if (!promotedTargetExists) return;
                    await rm(target, { recursive: true, force: true });
                    await mkdir(target);
                    await writeFile(join(target, 'user.txt'), 'unrelated');
                    throw new Error('operation cancelled');
                },
            })).rejects.toMatchObject({
                code: 'workspace_target_materialization_manual_recovery',
            });
            await expect(readFile(join(target, 'user.txt'), 'utf8')).resolves.toBe('unrelated');
            await expect(access(receiptPath)).resolves.toBeUndefined();
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('preserves a replaced target when the original target was absent', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-absent-original-'));
        try {
            const target = join(fixture, 'target');
            const materialization = await beginWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
            });
            expect(materialization.previousTargetPath).toBeUndefined();
            await mkdir(target);
            await writeFile(join(target, 'new.txt'), 'new');
            await materialization.custody.bindPromotedTarget();

            await rm(target, { recursive: true, force: true });
            await mkdir(target);
            await writeFile(join(target, 'user.txt'), 'unrelated');

            await expect(materialization.custody.abort()).rejects.toMatchObject({
                code: 'workspace_target_materialization_manual_recovery',
            });
            await expect(readFile(join(target, 'user.txt'), 'utf8')).resolves.toBe('unrelated');
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('removes an absent original target that was never replaced on abort', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-absent-abort-'));
        try {
            const target = join(fixture, 'target');
            const materialization = await beginWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
            });
            await mkdir(target);
            await writeFile(join(target, 'new.txt'), 'new');
            await materialization.custody.bindPromotedTarget();
            await materialization.custody.abort();
            await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('deletes the replaced-target backup only when custody commits', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-custody-'));
        try {
            const source = join(fixture, 'source');
            const target = join(fixture, 'target');
            await mkdir(source);
            await mkdir(target);
            await writeFile(join(source, 'new.txt'), 'new');
            await writeFile(join(target, 'old.txt'), 'old');
            const built = await buildScmWorkspaceIntegrationWorkspaceExportArtifactsWithBlobProviderFromTransferEntries({
                entries: [{ relativePath: 'new.txt', sourcePath: join(source, 'new.txt') }],
            });
            const materialized = await materializeWorkspaceExportArtifactsWithScmWorkspace({
                workspaceExportArtifacts: built.workspaceExportArtifacts,
                targetPath: target,
                conflictPolicy: 'replace_existing',
                blobProvider: built.blobProvider,
                registry,
                naming,
            });

            await materialized.custody.commit();
            await expect(readFile(join(target, 'new.txt'), 'utf8')).resolves.toBe('new');
            expect((await readdir(fixture)).some((name) => name.startsWith('.backup.'))).toBe(false);
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });

    it('keeps materialization custody metadata outside the synchronized workspace', async () => {
        const fixture = await mkdtemp(join(tmpdir(), 'workspace-export-no-in-root-custody-'));
        try {
            const target = join(fixture, 'target');
            const receiptPath = join(fixture, 'materialization.json');
            const materialization = await beginWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receiptPath,
            });
            await mkdir(target);
            await writeFile(join(target, 'user.txt'), 'user');
            await materialization.custody.bindPromotedTarget();

            expect(await readdir(target)).toEqual(['user.txt']);
            await expect(access(receiptPath)).resolves.toBeUndefined();
            await materialization.custody.commit();
        } finally {
            await rm(fixture, { recursive: true, force: true });
        }
    });
});
