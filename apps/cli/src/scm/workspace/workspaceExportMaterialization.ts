import { randomUUID } from 'node:crypto';
import { access, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, parse, resolve } from 'node:path';

import type { ScmBackendRegistry } from '../registry';
import { writeJsonAtomic } from '@/utils/fs/writeJsonAtomic';
import { runWithScmBackendRegistryLease } from '../scmBackendCatalog';
import { cleanupWorkspaceStaging } from './workspaceExportStaging/cleanupWorkspaceStaging';
import {
    createWorkspaceStagingRoot,
    type WorkspaceStagingRoot,
} from './workspaceExportStaging/createWorkspaceStagingRoot';
import { promoteStagedWorkspace } from './workspaceExportStaging/promoteStagedWorkspace';
import {
    stageWorkspaceEntries,
    type WorkspaceExportBlobProvider,
} from './workspaceExportStaging/stageWorkspaceEntries';
import {
    assertWorkspaceMaterializationSymlinkTarget,
    resolveContainedWorkspaceMaterializationPath,
} from './workspaceMaterializationSafety';
import { resolveWorkspaceMaterializationTargetPath } from './workspaceMaterializationTargetPath';

import {
    assertPortableWorkspaceEntriesWithScmWorkspace,
    reconcilePostMaterializationWithScmWorkspace,
} from '../workspace';
import type { ScmWorkspaceIntegrationWorkspaceExportArtifacts } from './workspaceExportArtifacts';
import type { ScmWorkspaceIntegrationWorkspaceTransferConflictPolicy } from './workspaceTransfer';

export type WorkspaceExportMaterializationNaming = Readonly<{
    siblingCopySuffixBase: string;
    backupDirectoryPrefix: string;
    stagingIdPrefix: string;
}>;

export type WorkspaceTargetMaterializationReceiptV1 = Readonly<{
    v: 1;
    previousTargetName: string | null;
}>;

export type WorkspaceExportMaterializationCustody = Readonly<{
    receipt: WorkspaceTargetMaterializationReceiptV1;
    commit(): Promise<void>;
    abort(): Promise<void>;
}>;

export type WorkspaceExportMaterializationResult = Readonly<{
    targetPath: string;
    custody: WorkspaceExportMaterializationCustody;
}>;

async function readMaterializationReceipt(path: string): Promise<WorkspaceTargetMaterializationReceiptV1 | null> {
    const raw = await readFile(path, 'utf8').catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    });
    if (raw === null) return null;
    try {
        const value = JSON.parse(raw) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)
            || Object.keys(value).sort().join('\0') !== ['previousTargetName', 'v'].sort().join('\0')) {
            throw new Error('invalid receipt');
        }
        const candidate = value as Record<string, unknown>;
        if (candidate.v !== 1
            || !(candidate.previousTargetName === null || typeof candidate.previousTargetName === 'string')) {
            throw new Error('invalid receipt');
        }
        return candidate as WorkspaceTargetMaterializationReceiptV1;
    } catch {
        throw new Error('Invalid workspace target materialization receipt');
    }
}

export async function prepareWorkspaceTargetMaterializationReceipt(input: Readonly<{
    targetPath: string;
    backupDirectoryPrefix: string;
    receiptPath: string;
    originalTargetExists: boolean;
}>): Promise<WorkspaceTargetMaterializationReceiptV1> {
    const existing = await readMaterializationReceipt(input.receiptPath);
    if (existing) {
        if ((existing.previousTargetName !== null) !== input.originalTargetExists) {
            throw new Error('Workspace target materialization receipt does not match the observed target state');
        }
        return existing;
    }
    const previousTargetPath = input.originalTargetExists
        ? join(dirname(input.targetPath), `${input.backupDirectoryPrefix}.${randomUUID()}`)
        : undefined;
    const receipt: WorkspaceTargetMaterializationReceiptV1 = Object.freeze({
        v: 1,
        previousTargetName: previousTargetPath ? basename(previousTargetPath) : null,
    });
    await writeJsonAtomic(input.receiptPath, receipt);
    return receipt;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function resolveWorkspaceExportMaterializationTargetPath(params: Readonly<{
    targetPath: string;
    conflictPolicy: ScmWorkspaceIntegrationWorkspaceTransferConflictPolicy;
    naming: WorkspaceExportMaterializationNaming;
}>): Promise<string> {
    return await resolveWorkspaceMaterializationTargetPath(params);
}

export async function beginWorkspaceTargetMaterialization(input: Readonly<{
    targetPath: string;
    backupDirectoryPrefix: string;
    /**
     * Bootstrap-owned durable receipt. When supplied, it is written before
     * the first destructive filesystem mutation and removed only on custody
     * settlement.
     */
    receiptPath?: string;
    /** The target state observed by the bootstrap owner before it created an empty root. */
    originalTargetExists?: boolean;
}>): Promise<Readonly<{
    previousTargetPath?: string;
    custody: WorkspaceExportMaterializationCustody;
}>> {
    const targetExists = await pathExists(input.targetPath);
    const originalTargetExists = input.originalTargetExists ?? targetExists;
    const receipt = input.receiptPath
        ? await prepareWorkspaceTargetMaterializationReceipt({
            targetPath: input.targetPath,
            backupDirectoryPrefix: input.backupDirectoryPrefix,
            receiptPath: input.receiptPath,
            originalTargetExists,
        })
        : Object.freeze({
            v: 1 as const,
            previousTargetName: originalTargetExists
                ? basename(join(dirname(input.targetPath), `${input.backupDirectoryPrefix}.${randomUUID()}`))
                : null,
        });
    const previousTargetPath = receipt.previousTargetName === null
        ? undefined
        : join(dirname(input.targetPath), receipt.previousTargetName);
    if (previousTargetPath) {
        await rename(input.targetPath, previousTargetPath);
    } else if (targetExists) {
        // Bootstrap may have created an empty root in order to acquire and
        // fingerprint it. It was still absent at the operation boundary.
        await rm(input.targetPath, { recursive: true, force: true });
    }

    let settled = false;
    return {
        ...(previousTargetPath ? { previousTargetPath } : {}),
        custody: Object.freeze({
            receipt,
            commit: async () => {
                if (settled) return;
                if (previousTargetPath) await rm(previousTargetPath, { recursive: true, force: true });
                if (input.receiptPath) await rm(input.receiptPath, { force: true });
                settled = true;
            },
            abort: async () => {
                if (settled) return;
                await rm(input.targetPath, { recursive: true, force: true });
                if (previousTargetPath && await pathExists(previousTargetPath)) {
                    await rename(previousTargetPath, input.targetPath);
                }
                if (input.receiptPath) await rm(input.receiptPath, { force: true });
                settled = true;
            },
        }),
    };
}

/** Rebuilds the narrow rollback closure from a root-bound durable receipt. */
export async function rehydrateWorkspaceTargetMaterialization(input: Readonly<{
    targetPath: string;
    backupDirectoryPrefix: string;
    receipt: WorkspaceTargetMaterializationReceiptV1;
    receiptPath?: string;
}>): Promise<WorkspaceExportMaterializationCustody | null> {
    if (input.receipt.v !== 1) throw new Error('Unsupported workspace target materialization receipt');
    const targetPath = resolve(input.targetPath);
    const expectedPrefix = `${input.backupDirectoryPrefix}.`;
    const previousTargetName = input.receipt.previousTargetName;
    if (previousTargetName !== null && (
        basename(previousTargetName) !== previousTargetName
        || !previousTargetName.startsWith(expectedPrefix)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
            .test(previousTargetName.slice(expectedPrefix.length))
    )) {
        throw new Error('Invalid workspace target materialization receipt');
    }
    const previousTargetPath = previousTargetName === null
        ? undefined
        : join(dirname(targetPath), previousTargetName);
    // A named backup disappears only when commit crosses its destructive
    // boundary. Treat that exact state as settled instead of deleting target.
    if (previousTargetPath && !(await pathExists(previousTargetPath))) {
        if (input.receiptPath) await rm(input.receiptPath, { force: true });
        return null;
    }

    let settled = false;
    return Object.freeze({
        receipt: input.receipt,
        commit: async () => {
            if (settled) return;
            if (previousTargetPath) await rm(previousTargetPath, { recursive: true, force: true });
            if (input.receiptPath) await rm(input.receiptPath, { force: true });
            settled = true;
        },
        abort: async () => {
            if (settled) return;
            await rm(targetPath, { recursive: true, force: true });
            if (previousTargetPath && await pathExists(previousTargetPath)) {
                await rename(previousTargetPath, targetPath);
            }
            if (input.receiptPath) await rm(input.receiptPath, { force: true });
            settled = true;
        },
    });
}

/**
 * Aborts an interrupted pre-READY materialization using only the receipt
 * written before mutation. A missing named backup means the rename never
 * happened; the original target is therefore left untouched.
 */
export async function recoverInterruptedWorkspaceTargetMaterialization(input: Readonly<{
    targetPath: string;
    backupDirectoryPrefix: string;
    receiptPath: string;
}>): Promise<boolean> {
    const receipt = await readMaterializationReceipt(input.receiptPath);
    if (!receipt) return false;

    const custody = await rehydrateWorkspaceTargetMaterialization({
        targetPath: input.targetPath,
        backupDirectoryPrefix: input.backupDirectoryPrefix,
        receipt,
        receiptPath: input.receiptPath,
    });
    await custody?.abort();
    return true;
}

export async function materializeWorkspaceExportArtifactsWithScmWorkspace(params: Readonly<{
    workspaceExportArtifacts: ScmWorkspaceIntegrationWorkspaceExportArtifacts;
    targetPath: string;
    conflictPolicy: ScmWorkspaceIntegrationWorkspaceTransferConflictPolicy;
    blobProvider: WorkspaceExportBlobProvider;
    registry?: ScmBackendRegistry;
    sourcePath?: string;
    naming: WorkspaceExportMaterializationNaming;
    materializationReceiptPath?: string;
    originalTargetExists?: boolean;
    assertCanContinue?: () => Promise<void>;
}>): Promise<WorkspaceExportMaterializationResult> {
    if (!params.registry) {
        return await runWithScmBackendRegistryLease(undefined, async (registry) =>
            await materializeWorkspaceExportArtifactsWithScmWorkspace({
                ...params,
                registry,
            }));
    }

    const targetPath = await resolveWorkspaceExportMaterializationTargetPath({
        targetPath: params.targetPath,
        conflictPolicy: params.conflictPolicy,
        naming: params.naming,
    });
    await assertPortableWorkspaceEntriesWithScmWorkspace({
        entries: params.workspaceExportArtifacts.manifest.entries,
        registry: params.registry,
    });

    const stagingRoot = await createWorkspaceStagingRoot({
        parentDirectory: dirname(targetPath),
        stagingId: `${params.naming.stagingIdPrefix}-${randomUUID()}`,
    });

    let targetMaterialization: Awaited<ReturnType<typeof beginWorkspaceTargetMaterialization>> | undefined;
    try {
        for (const entry of params.workspaceExportArtifacts.manifest.entries) {
            const materializedEntryPath = resolveContainedWorkspaceMaterializationPath({
                workspaceRoot: stagingRoot.workspaceDirectory,
                candidatePath: entry.relativePath,
                errorMessage: `Workspace transfer path escapes target: ${entry.relativePath}`,
            });
            if (entry.kind !== 'symlink') continue;
            assertWorkspaceMaterializationSymlinkTarget({
                workspaceRoot: stagingRoot.workspaceDirectory,
                linkPath: materializedEntryPath,
                target: entry.target,
            });
        }

        const staged = await stageWorkspaceEntries({
            stagingRoot,
            expectedManifest: params.workspaceExportArtifacts.manifest,
            blobProvider: params.blobProvider,
            scmRegistry: params.registry,
            assertCanContinue: params.assertCanContinue,
        });
        if (!staged.verification.isVerified) {
            throw new Error(`Workspace transfer integrity check failed for ${targetPath}`);
        }

        await params.assertCanContinue?.();

        targetMaterialization = await beginWorkspaceTargetMaterialization({
            targetPath,
            backupDirectoryPrefix: params.naming.backupDirectoryPrefix,
            ...(params.materializationReceiptPath ? { receiptPath: params.materializationReceiptPath } : {}),
            ...(params.originalTargetExists === undefined ? {} : { originalTargetExists: params.originalTargetExists }),
        });
        await promoteStagedWorkspace({
            stagingRoot,
            targetWorkspaceDirectory: targetPath,
            expectedManifest: params.workspaceExportArtifacts.manifest,
            scmRegistry: params.registry,
        });

        await params.assertCanContinue?.();
        await reconcilePostMaterializationWithScmWorkspace({
            targetPath,
            previousTargetPath: targetMaterialization.previousTargetPath,
            sourcePath: params.sourcePath,
            workspaceIntegrationMetadata: params.workspaceExportArtifacts.workspaceIntegrationMetadata,
            registry: params.registry,
        });
        await params.assertCanContinue?.();
    } catch (error) {
        await targetMaterialization?.custody.abort().catch(() => undefined);
        await cleanupWorkspaceStaging({ rootDirectory: stagingRoot.rootDirectory }).catch(() => undefined);
        throw error;
    }

    await cleanupWorkspaceStaging({ rootDirectory: stagingRoot.rootDirectory }).catch(() => undefined);

    return {
        targetPath,
        custody: targetMaterialization!.custody,
    };
}
