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
import {
    isWorkspaceSyncRootObjectIdentityV1,
    readWorkspaceSyncRootObjectIdentity,
    workspaceSyncRootObjectIdentitiesEqual,
    type WorkspaceSyncRootObjectIdentityV1,
} from '@/workspaces/sync/workspaceSyncRootIdentity';

export type WorkspaceExportMaterializationNaming = Readonly<{
    siblingCopySuffixBase: string;
    backupDirectoryPrefix: string;
    stagingIdPrefix: string;
}>;

export type WorkspaceTargetMaterializationReceiptV1 = Readonly<{
    v: 1;
    previousTargetName: string | null;
    originalTargetIdentity: WorkspaceSyncRootObjectIdentityV1 | null;
    promotedTargetIdentity: WorkspaceSyncRootObjectIdentityV1 | null;
    expectedBackupIdentity: WorkspaceSyncRootObjectIdentityV1 | null;
}>;

export type WorkspaceExportMaterializationCustody = Readonly<{
    receipt: WorkspaceTargetMaterializationReceiptV1;
    bindPromotedTarget(): Promise<void>;
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
            || Object.keys(value).sort().join('\0') !== [
                'expectedBackupIdentity',
                'originalTargetIdentity',
                'previousTargetName',
                'promotedTargetIdentity',
                'v',
            ].sort().join('\0')) {
            throw new Error('invalid receipt');
        }
        const candidate = value as Record<string, unknown>;
        if (candidate.v !== 1
            || !(candidate.previousTargetName === null || typeof candidate.previousTargetName === 'string')
            || !(candidate.originalTargetIdentity === null
                || isWorkspaceSyncRootObjectIdentityV1(candidate.originalTargetIdentity))
            || !(candidate.promotedTargetIdentity === null
                || isWorkspaceSyncRootObjectIdentityV1(candidate.promotedTargetIdentity))
            || !(candidate.expectedBackupIdentity === null
                || isWorkspaceSyncRootObjectIdentityV1(candidate.expectedBackupIdentity))) {
            throw new Error('invalid receipt');
        }
        return candidate as WorkspaceTargetMaterializationReceiptV1;
    } catch {
        throw materializationRecoveryError('Invalid or unsupported workspace target materialization receipt');
    }
}

function materializationRecoveryError(message: string): Error {
    return Object.assign(new Error(message), { code: 'workspace_target_materialization_manual_recovery' });
}

async function readObjectIdentityOrAbsent(path: string): Promise<WorkspaceSyncRootObjectIdentityV1 | null> {
    try {
        return await readWorkspaceSyncRootObjectIdentity(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw materializationRecoveryError(`Cannot prove filesystem identity for ${path}`);
    }
}

async function assertObjectIdentity(
    path: string,
    expected: WorkspaceSyncRootObjectIdentityV1,
): Promise<void> {
    const actual = await readObjectIdentityOrAbsent(path);
    if (!actual || !workspaceSyncRootObjectIdentitiesEqual(actual, expected)) {
        throw materializationRecoveryError(`Filesystem object changed at ${path}`);
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
            throw materializationRecoveryError('Workspace target materialization receipt does not match the observed target state');
        }
        return existing;
    }
    const originalTargetIdentity = await readObjectIdentityOrAbsent(input.targetPath);
    if (input.originalTargetExists && originalTargetIdentity === null) {
        throw materializationRecoveryError('Workspace target disappeared before materialization custody was recorded');
    }
    const previousTargetPath = input.originalTargetExists
        ? join(dirname(input.targetPath), `${input.backupDirectoryPrefix}.${randomUUID()}`)
        : undefined;
    const receipt: WorkspaceTargetMaterializationReceiptV1 = Object.freeze({
        v: 1,
        previousTargetName: previousTargetPath ? basename(previousTargetPath) : null,
        originalTargetIdentity,
        promotedTargetIdentity: null,
        expectedBackupIdentity: previousTargetPath ? originalTargetIdentity : null,
    });
    await writeJsonAtomic(input.receiptPath, receipt);
    return receipt;
}

async function pathExists(path: string): Promise<boolean> {
    return await access(path).then(() => true, () => false);
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
    let receipt = input.receiptPath
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
            originalTargetIdentity: await readObjectIdentityOrAbsent(input.targetPath),
            promotedTargetIdentity: null,
            expectedBackupIdentity: null,
        });
    if (receipt.previousTargetName !== null && receipt.expectedBackupIdentity === null) {
        receipt = Object.freeze({ ...receipt, expectedBackupIdentity: receipt.originalTargetIdentity });
    }
    const previousTargetPath = receipt.previousTargetName === null
        ? undefined
        : join(dirname(input.targetPath), receipt.previousTargetName);
    if (previousTargetPath) {
        if (!receipt.originalTargetIdentity || !receipt.expectedBackupIdentity) {
            throw materializationRecoveryError('Original target identity is unavailable');
        }
        await assertObjectIdentity(input.targetPath, receipt.originalTargetIdentity);
        await rename(input.targetPath, previousTargetPath);
        await assertObjectIdentity(previousTargetPath, receipt.expectedBackupIdentity);
    } else if (targetExists) {
        // Bootstrap may have created an empty root in order to acquire and
        // fingerprint it. It was still absent at the operation boundary.
        if (!receipt.originalTargetIdentity) {
            throw materializationRecoveryError('Prepared target identity is unavailable');
        }
        await assertObjectIdentity(input.targetPath, receipt.originalTargetIdentity);
        await rm(input.targetPath, { recursive: true, force: true });
    }

    let settled = false;
    const custody: WorkspaceExportMaterializationCustody = Object.freeze({
        get receipt() {
            return receipt;
        },
        bindPromotedTarget: async () => {
            if (settled) return;
            const promotedTargetIdentity = await readObjectIdentityOrAbsent(input.targetPath);
            if (!promotedTargetIdentity) {
                throw materializationRecoveryError('Promoted target identity is unavailable');
            }
            receipt = Object.freeze({ ...receipt, promotedTargetIdentity });
            if (input.receiptPath) await writeJsonAtomic(input.receiptPath, receipt);
        },
        commit: async () => {
            if (settled) return;
            if (!receipt.promotedTargetIdentity) {
                throw materializationRecoveryError('Promoted target identity was not bound');
            }
            await assertObjectIdentity(input.targetPath, receipt.promotedTargetIdentity);
            if (previousTargetPath) {
                if (!receipt.expectedBackupIdentity) {
                    throw materializationRecoveryError('Backup identity is unavailable');
                }
                await assertObjectIdentity(previousTargetPath, receipt.expectedBackupIdentity);
                await rm(previousTargetPath, { recursive: true, force: true });
            }
            if (input.receiptPath) await rm(input.receiptPath, { force: true });
            settled = true;
        },
        abort: async () => {
            if (settled) return;
            if (!receipt.promotedTargetIdentity) {
                throw materializationRecoveryError('Promoted target identity was not bound');
            }
            await assertObjectIdentity(input.targetPath, receipt.promotedTargetIdentity);
            if (previousTargetPath) {
                if (!receipt.expectedBackupIdentity) {
                    throw materializationRecoveryError('Backup identity is unavailable');
                }
                await assertObjectIdentity(previousTargetPath, receipt.expectedBackupIdentity);
            }
            await rm(input.targetPath, { recursive: true, force: true });
            if (previousTargetPath) {
                await rename(previousTargetPath, input.targetPath);
            }
            if (input.receiptPath) await rm(input.receiptPath, { force: true });
            settled = true;
        },
    });
    return {
        ...(previousTargetPath ? { previousTargetPath } : {}),
        custody,
    };
}

/** Rebuilds the narrow rollback closure from a root-bound durable receipt. */
export async function rehydrateWorkspaceTargetMaterialization(input: Readonly<{
    targetPath: string;
    backupDirectoryPrefix: string;
    receipt: WorkspaceTargetMaterializationReceiptV1;
    receiptPath?: string;
}>): Promise<WorkspaceExportMaterializationCustody | null> {
    const receipt = input.receipt as unknown;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || Object.keys(receipt).sort().join('\0') !== [
            'expectedBackupIdentity',
            'originalTargetIdentity',
            'previousTargetName',
            'promotedTargetIdentity',
            'v',
        ].sort().join('\0')) {
        throw materializationRecoveryError('Unsupported partial workspace target materialization receipt');
    }
    const candidate = receipt as Record<string, unknown>;
    if (candidate.v !== 1
        || !(candidate.previousTargetName === null || typeof candidate.previousTargetName === 'string')
        || !(candidate.originalTargetIdentity === null || isWorkspaceSyncRootObjectIdentityV1(candidate.originalTargetIdentity))
        || !(candidate.promotedTargetIdentity === null || isWorkspaceSyncRootObjectIdentityV1(candidate.promotedTargetIdentity))
        || !(candidate.expectedBackupIdentity === null || isWorkspaceSyncRootObjectIdentityV1(candidate.expectedBackupIdentity))) {
        throw materializationRecoveryError('Invalid workspace target materialization receipt identity');
    }
    const validatedReceipt = candidate as WorkspaceTargetMaterializationReceiptV1;
    const targetPath = resolve(input.targetPath);
    const expectedPrefix = `${input.backupDirectoryPrefix}.`;
    const previousTargetName = validatedReceipt.previousTargetName;
    if (previousTargetName !== null && (
        basename(previousTargetName) !== previousTargetName
        || !previousTargetName.startsWith(expectedPrefix)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
            .test(previousTargetName.slice(expectedPrefix.length))
    )) {
        throw materializationRecoveryError('Invalid workspace target materialization receipt');
    }
    const previousTargetPath = previousTargetName === null
        ? undefined
        : join(dirname(targetPath), previousTargetName);
    const targetIdentity = await readObjectIdentityOrAbsent(targetPath);
    const backupIdentity = previousTargetPath ? await readObjectIdentityOrAbsent(previousTargetPath) : null;
    const targetIsOriginal = targetIdentity !== null
        && validatedReceipt.originalTargetIdentity !== null
        && workspaceSyncRootObjectIdentitiesEqual(targetIdentity, validatedReceipt.originalTargetIdentity);
    const targetIsPromoted = targetIdentity !== null
        && validatedReceipt.promotedTargetIdentity !== null
        && workspaceSyncRootObjectIdentitiesEqual(targetIdentity, validatedReceipt.promotedTargetIdentity);
    const backupMatches = backupIdentity !== null
        && validatedReceipt.expectedBackupIdentity !== null
        && workspaceSyncRootObjectIdentitiesEqual(backupIdentity, validatedReceipt.expectedBackupIdentity);

    if (backupIdentity && !backupMatches) {
        throw materializationRecoveryError('Expected backup pathname is occupied by another filesystem object');
    }
    if (targetIdentity && !targetIsOriginal && !targetIsPromoted) {
        throw materializationRecoveryError('Target pathname is occupied by another filesystem object');
    }
    // Once the verified backup object is absent, the destructive commit
    // boundary has already crossed. Recovery never deletes the target in this
    // state; it only clears the now-settled receipt.
    if (previousTargetPath && !backupIdentity && (targetIsOriginal || targetIsPromoted)) {
        if (input.receiptPath) await rm(input.receiptPath, { force: true });
        return null;
    }

    if (!previousTargetPath && !targetIdentity) {
        if (input.receiptPath) await rm(input.receiptPath, { force: true });
        return null;
    }
    if (validatedReceipt.promotedTargetIdentity === null && targetIdentity !== null && !targetIsOriginal) {
        throw materializationRecoveryError('Interrupted materialization has an unbound target object');
    }

    let settled = false;
    return Object.freeze({
        receipt: validatedReceipt,
        bindPromotedTarget: async () => {
            throw materializationRecoveryError('Rehydrated materialization cannot bind a new promoted target');
        },
        commit: async () => {
            if (settled) return;
            if (!validatedReceipt.promotedTargetIdentity) {
                throw materializationRecoveryError('Promoted target identity was not durably bound');
            }
            await assertObjectIdentity(targetPath, validatedReceipt.promotedTargetIdentity);
            if (previousTargetPath) {
                if (!validatedReceipt.expectedBackupIdentity) {
                    throw materializationRecoveryError('Backup identity is unavailable');
                }
                await assertObjectIdentity(previousTargetPath, validatedReceipt.expectedBackupIdentity);
                await rm(previousTargetPath, { recursive: true, force: true });
            }
            if (input.receiptPath) await rm(input.receiptPath, { force: true });
            settled = true;
        },
        abort: async () => {
            if (settled) return;
            const currentTargetIdentity = await readObjectIdentityOrAbsent(targetPath);
            if (currentTargetIdentity) {
                const expectedTargetIdentity = validatedReceipt.promotedTargetIdentity ?? validatedReceipt.originalTargetIdentity;
                if (!expectedTargetIdentity
                    || !workspaceSyncRootObjectIdentitiesEqual(currentTargetIdentity, expectedTargetIdentity)) {
                    throw materializationRecoveryError('Target pathname is occupied by another filesystem object');
                }
            }
            if (previousTargetPath) {
                if (!validatedReceipt.expectedBackupIdentity) {
                    throw materializationRecoveryError('Backup identity is unavailable');
                }
                await assertObjectIdentity(previousTargetPath, validatedReceipt.expectedBackupIdentity);
            }
            if (currentTargetIdentity) {
                await rm(targetPath, { recursive: true, force: true });
            }
            if (previousTargetPath) {
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

/** Rebuilds READY-but-unsettled custody from the sole durable receipt. */
export async function rehydrateWorkspaceTargetMaterializationFromReceiptPath(input: Readonly<{
    targetPath: string;
    backupDirectoryPrefix: string;
    receiptPath: string;
}>): Promise<WorkspaceExportMaterializationCustody | null> {
    const receipt = await readMaterializationReceipt(input.receiptPath);
    if (!receipt) return null;
    return await rehydrateWorkspaceTargetMaterialization({
        targetPath: input.targetPath,
        backupDirectoryPrefix: input.backupDirectoryPrefix,
        receipt,
        receiptPath: input.receiptPath,
    });
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
        await targetMaterialization.custody.bindPromotedTarget();

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
        let rollbackError: unknown;
        try {
            await targetMaterialization?.custody.abort();
        } catch (cause) {
            rollbackError = cause;
        }
        await cleanupWorkspaceStaging({ rootDirectory: stagingRoot.rootDirectory }).catch(() => undefined);
        if (rollbackError !== undefined) {
            const rollbackCode = (rollbackError as { code?: unknown }).code;
            throw Object.assign(
                new AggregateError(
                    [error, rollbackError],
                    rollbackError instanceof Error
                        ? rollbackError.message
                        : 'Workspace target rollback requires manual recovery',
                    { cause: error },
                ),
                {
                    code: typeof rollbackCode === 'string'
                        ? rollbackCode
                        : 'workspace_target_materialization_manual_recovery',
                },
            );
        }
        throw error;
    }

    await cleanupWorkspaceStaging({ rootDirectory: stagingRoot.rootDirectory }).catch(() => undefined);

    return {
        targetPath,
        custody: targetMaterialization!.custody,
    };
}
