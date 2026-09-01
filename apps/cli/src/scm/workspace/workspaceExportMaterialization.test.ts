import { spawn } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createScmBackendRegistry } from '@/scm/registry';
import { buildScmWorkspaceIntegrationWorkspaceExportArtifactsWithBlobProviderFromTransferEntries } from './workspaceExportArtifacts';
import {
    beginWorkspaceTargetMaterialization,
    materializeWorkspaceExportArtifactsWithScmWorkspace,
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
            await expect(rehydrateWorkspaceTargetMaterialization({
                targetPath: target,
                backupDirectoryPrefix: '.backup',
                receipt: { v: 1, previousTargetName: '../other' },
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
});
