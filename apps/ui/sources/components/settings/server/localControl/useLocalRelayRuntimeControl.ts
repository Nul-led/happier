import * as React from 'react';
import type { SystemTaskResult } from '@happier-dev/protocol';

import { getDefaultSystemTaskRunner, useSystemTaskSnapshot, waitForSystemTaskResult } from '@/components/systemTasks';
import type { SystemTaskRunState, SystemTaskRunner } from '@/components/systemTasks/types';
import { isSystemTaskBridgeUnavailableError, readSystemTaskStartErrorMessage } from '@/components/systemTasks/systemTaskStartError';
import { t } from '@/text';
import {
    buildLocalRelayRuntimeSystemTaskSpec,
    type LocalRelayRuntimeTaskOptions,
} from '@/components/systemTasks/specs/localControl/buildLocalRelayRuntimeSystemTaskSpec';
import { readRelayRuntimeStatusData, type RelayRuntimeStatusData } from './relayRuntimeStatus';

type RelayRuntimeActionKind =
    | 'relay.runtime.installOrUpdate.v1'
    | 'relay.runtime.start.v1'
    | 'relay.runtime.restart.v1'
    | 'relay.runtime.stop.v1';

type PersonalHomeTaskKind =
    | 'relay.runtime.personal_home.inspect.v1'
    | 'relay.runtime.personal_home.backup.v1'
    | 'relay.runtime.personal_home.verify_backup.v1'
    | 'relay.runtime.personal_home.restore.v1'
    | 'relay.runtime.personal_home.erase.v1';

type PersonalHomeInspection = Readonly<{
    homeServerIdentityId: string | null;
    schemaVersion: string | null;
    running: boolean;
    masterSecretPresent: boolean;
    databasePresent: boolean;
    databaseBytes: number;
    backupsCount: number;
    latestBackup: Readonly<{
        path: string;
        createdAt: string;
        archiveBytes: number;
    }> | null;
    layoutPaths: Readonly<{
        dataDir: string;
        configDir: string;
        logsDir: string;
        backupsDir: string;
    }>;
    ownedErasePaths: readonly string[];
    estimatedOwnedBytes: number | null;
    destinationEmpty: boolean;
    restoreRecovery: Readonly<{ status: 'none' | 'rollback_available' | 'finalization_available' | 'ambiguous'; affectedTargets: readonly string[] }>;
}>;

type PersonalHomeVerification = Readonly<{
    archivePath: string;
    identityMatchesCurrentHome: string | null;
    homeServerIdentityId: string | null;
}>;

type PersonalHomeLastOperation =
    | Readonly<{ operation: 'backup'; backup: Readonly<{ path: string; bytes: number; sha256: string; homeServerIdentityId: string; createdAt: string; homeNeedsAttention: boolean }> }>
    | Readonly<{ operation: 'restore'; restore: Readonly<{ outcome: string; rollbackPaths: readonly string[]; error: string | null }> }>
    | Readonly<{ operation: 'erase'; erase: Readonly<{ removedPaths: readonly string[]; remainingUnknownPaths: readonly string[]; stoppedRunningHome: boolean }> }>;

export async function runRelayRuntimeUninstallTask(runner: SystemTaskRunner): Promise<boolean> {
    const taskId = await runner.start(buildLocalRelayRuntimeSystemTaskSpec('relay.runtime.uninstall.v1'));
    const result = await waitForSystemTaskResult(runner, taskId);
    if (!result.ok) {
        const message = readErrorMessage(result);
        throw new Error(message ?? t('settings.systemTaskStartFailed'));
    }
    if ((result.data as Record<string, unknown> | undefined)?.uninstalled !== true) {
        throw new Error('Runtime uninstall did not confirm completion.');
    }
    return true;
}

function readErrorMessage(result: SystemTaskResult | null): string | null {
    if (!result || result.ok) {
        return null;
    }
    const message = typeof result.error?.message === 'string' ? result.error.message.trim() : '';
    return message || null;
}

export function useLocalRelayRuntimeControl(options: Readonly<{
    runner?: SystemTaskRunner;
}> = {}) {
    const runner = options.runner ?? getDefaultSystemTaskRunner();
    const [bridgeUnavailable, setBridgeUnavailable] = React.useState(false);
    const isUnavailable = runner.mode === 'unavailable' || bridgeUnavailable;
    const [statusTaskId, setStatusTaskId] = React.useState<string | null>(null);
    const [actionTaskId, setActionTaskId] = React.useState<string | null>(null);
    const [lastStatus, setLastStatus] = React.useState<RelayRuntimeStatusData | null>(null);
    const [lastErrorMessage, setLastErrorMessage] = React.useState<string | null>(null);
    const [inspection, setInspection] = React.useState<PersonalHomeInspection | null>(null);
    const [lastVerification, setLastVerification] = React.useState<PersonalHomeVerification | null>(null);
    const [lastOperation, setLastOperation] = React.useState<PersonalHomeLastOperation | null>(null);
    const [operationTaskId, setOperationTaskId] = React.useState<string | null>(null);
    const [activeOperationKind, setActiveOperationKind] = React.useState<PersonalHomeTaskKind | null>(null);
    const autoRefreshRequestedRef = React.useRef(false);
    const handledActionTaskIdRef = React.useRef<string | null>(null);

    const statusSnapshot = useSystemTaskSnapshot(runner, statusTaskId);
    const actionSnapshot = useSystemTaskSnapshot(runner, actionTaskId);
    const operationSnapshot = useSystemTaskSnapshot(runner, operationTaskId);

    const startTask = React.useCallback(async (
        kind: RelayRuntimeActionKind | PersonalHomeTaskKind | 'relay.runtime.status.v1',
        taskOptions: LocalRelayRuntimeTaskOptions = {},
    ) => {
        try {
            const taskId = await runner.start(buildLocalRelayRuntimeSystemTaskSpec(kind, taskOptions));
            setBridgeUnavailable(false);
            setLastErrorMessage(null);
            return taskId;
        } catch (error) {
            const message = readSystemTaskStartErrorMessage(error);
            const unavailable = isSystemTaskBridgeUnavailableError(error);
            setBridgeUnavailable(unavailable);
            setLastErrorMessage(unavailable
                ? t('settings.systemTaskBridgeUnavailable')
                : (message ?? t('settings.systemTaskStartFailed')));
            return null;
        }
    }, [runner]);

    const refreshStatus = React.useCallback(async () => {
        if (isUnavailable) {
            return null;
        }
        const taskId = await startTask('relay.runtime.status.v1');
        if (!taskId) {
            return null;
        }
        setStatusTaskId(taskId);
        return taskId;
    }, [isUnavailable, startTask]);

    const runAction = React.useCallback(async (kind: RelayRuntimeActionKind | PersonalHomeTaskKind, taskOptions: LocalRelayRuntimeTaskOptions = {}) => {
        if (isUnavailable) {
            return null;
        }
        const taskId = await startTask(kind, taskOptions);
        if (!taskId) {
            return null;
        }
        handledActionTaskIdRef.current = null;
        setActionTaskId(taskId);
        return taskId;
    }, [isUnavailable, startTask]);

    const runTaskAndWait = React.useCallback(async (
        kind: RelayRuntimeActionKind | PersonalHomeTaskKind | 'relay.runtime.status.v1',
        taskOptions: LocalRelayRuntimeTaskOptions = {},
    ): Promise<SystemTaskResult | null> => {
        if (isUnavailable) return null;
        const taskId = kind === 'relay.runtime.status.v1'
            ? await startTask(kind, taskOptions)
            : await runAction(kind, taskOptions);
        if (!taskId) return null;
        if (kind === 'relay.runtime.status.v1') setStatusTaskId(taskId);
        return await waitForSystemTaskResult(runner, taskId);
    }, [isUnavailable, runAction, runner, startTask]);

    React.useEffect(() => {
        if (isUnavailable) {
            return;
        }
        if (autoRefreshRequestedRef.current) {
            return;
        }
        autoRefreshRequestedRef.current = true;
        void refreshStatus().catch(() => {});
    }, [isUnavailable, refreshStatus]);

    React.useEffect(() => {
        const nextStatus = readRelayRuntimeStatusData(statusSnapshot?.result ?? null);
        if (nextStatus) {
            setLastStatus(nextStatus);
            setLastErrorMessage(null);
            return;
        }

        const errorMessage = readErrorMessage(statusSnapshot?.result ?? null);
        if (errorMessage) {
            setLastErrorMessage(errorMessage);
        }
    }, [statusSnapshot]);

    React.useEffect(() => {
        if (!actionSnapshot?.result || handledActionTaskIdRef.current === actionSnapshot.taskId) {
            return;
        }

        handledActionTaskIdRef.current = actionSnapshot.taskId;
        if (!actionSnapshot.result.ok) {
            setLastErrorMessage(readErrorMessage(actionSnapshot.result));
            return;
        }

        const inlineStatus = readRelayRuntimeStatusData(actionSnapshot.result);
        if (inlineStatus) {
            setLastStatus(inlineStatus);
            setLastErrorMessage(null);
        }

        void refreshStatus().catch(() => {});
    }, [actionSnapshot, refreshStatus]);

    const activeTaskSnapshot = React.useMemo<SystemTaskRunState | null>(() => {
        const snapshot = actionSnapshot?.result ? null : actionSnapshot ?? (statusSnapshot?.result ? null : statusSnapshot);
        return snapshot ?? null;
    }, [actionSnapshot, statusSnapshot]);

    const isBusy = activeTaskSnapshot != null && activeTaskSnapshot.result == null;

    const runPersonalHomeTask = React.useCallback(async (
        kind: PersonalHomeTaskKind,
        taskOptions: LocalRelayRuntimeTaskOptions = {},
        retainSnapshot = true,
    ): Promise<SystemTaskResult | null> => {
        if (isUnavailable) return null;
        if (lastStatus?.purpose?.kind !== 'personal-home') {
            setLastErrorMessage(t('settings.localRelayRuntime.statusChecking'));
            return null;
        }
        const taskId = await runAction(kind, {
            ...taskOptions,
            purpose: lastStatus.purpose,
        });
        if (!taskId) return null;
        if (retainSnapshot) {
            setOperationTaskId(taskId);
            setActiveOperationKind(kind);
        }
        const result = await waitForSystemTaskResult(runner, taskId);
        if (!result.ok) {
            setLastErrorMessage(readErrorMessage(result));
            return null;
        }
        setLastErrorMessage(null);
        return result;
    }, [isUnavailable, lastStatus?.purpose, runAction, runner]);

    const refreshInspection = React.useCallback(async (): Promise<PersonalHomeInspection | null> => {
        const result = await runPersonalHomeTask('relay.runtime.personal_home.inspect.v1', {}, false);
        if (!result?.ok) return null;
        const data = result.data as Record<string, unknown> | undefined;
        const identity = data?.identity && typeof data.identity === 'object' ? data.identity as Record<string, unknown> : {};
        const masterSecret = data?.masterSecret && typeof data.masterSecret === 'object' ? data.masterSecret as Record<string, unknown> : {};
        const storage = data?.storage && typeof data.storage === 'object' ? data.storage as Record<string, unknown> : {};
        const layout = data?.layout && typeof data.layout === 'object' ? data.layout as Record<string, unknown> : {};
        const restoreRecoveryValue = data?.restoreRecovery && typeof data.restoreRecovery === 'object'
            ? data.restoreRecovery as Record<string, unknown> : {};
        const restoreRecoveryStatus = restoreRecoveryValue.status === 'rollback_available'
            || restoreRecoveryValue.status === 'finalization_available'
            || restoreRecoveryValue.status === 'ambiguous'
            ? restoreRecoveryValue.status : 'none';
        const latestBackupValue = storage.latestBackup && typeof storage.latestBackup === 'object'
            ? storage.latestBackup as Record<string, unknown>
            : null;
        const latestBackup = latestBackupValue
            && typeof latestBackupValue.path === 'string'
            && typeof latestBackupValue.createdAt === 'string'
            && typeof latestBackupValue.archiveBytes === 'number'
            && Number.isFinite(latestBackupValue.archiveBytes)
            && latestBackupValue.archiveBytes >= 0
            ? {
                path: latestBackupValue.path,
                createdAt: latestBackupValue.createdAt,
                archiveBytes: latestBackupValue.archiveBytes,
            }
            : null;
        const facts: PersonalHomeInspection = {
            homeServerIdentityId: typeof identity.homeServerIdentityId === 'string' ? identity.homeServerIdentityId : null,
            schemaVersion: typeof identity.schemaVersion === 'string' ? identity.schemaVersion : null,
            running: data?.running === true,
            masterSecretPresent: masterSecret.present === true,
            databasePresent: storage.databasePresent === true,
            databaseBytes: typeof storage.databaseBytes === 'number' ? storage.databaseBytes : 0,
            backupsCount: typeof storage.backupsCount === 'number' ? storage.backupsCount : 0,
            latestBackup,
            layoutPaths: {
                dataDir: typeof layout.dataDir === 'string' ? layout.dataDir : '',
                configDir: typeof layout.configDir === 'string' ? layout.configDir : '',
                logsDir: typeof layout.logsDir === 'string' ? layout.logsDir : '',
                backupsDir: typeof layout.backupsDir === 'string' ? layout.backupsDir : '',
            },
            ownedErasePaths: Array.isArray(storage.ownedErasePaths) ? storage.ownedErasePaths.filter((value): value is string => typeof value === 'string') : [],
            estimatedOwnedBytes: typeof storage.estimatedOwnedBytes === 'number' ? storage.estimatedOwnedBytes : null,
            destinationEmpty: storage.destinationEmpty === true,
            restoreRecovery: {
                status: restoreRecoveryStatus,
                affectedTargets: Array.isArray(restoreRecoveryValue.affectedTargets)
                    ? restoreRecoveryValue.affectedTargets.filter((value): value is string => typeof value === 'string') : [],
            },
        };
        setInspection(facts);
        return facts;
    }, [runPersonalHomeTask]);

    const refreshAfterMutation = React.useCallback(() => {
        void refreshStatus().catch(() => {});
        void refreshInspection().catch(() => {});
    }, [refreshInspection, refreshStatus]);

    return {
        activeTaskSnapshot,
        runTask: React.useCallback(async (kind: RelayRuntimeActionKind | PersonalHomeTaskKind | 'relay.runtime.status.v1', taskOptions: LocalRelayRuntimeTaskOptions = {}) => {
            if (kind === 'relay.runtime.status.v1') return await startTask(kind, taskOptions);
            return await runAction(kind, taskOptions);
        }, [runAction, startTask]),
        runTaskAndWait,
        backupPersonalHome: React.useCallback(async (input: Readonly<{ outputPath?: string; intent?: 'standard' | 'erase-safety' }> = {}) => {
            const result = await runPersonalHomeTask('relay.runtime.personal_home.backup.v1', {
                personalHomeOperation: {
                    ...(input.outputPath?.trim() ? { outputPath: input.outputPath.trim() } : {}),
                    ...(input.intent ? { intent: input.intent } : {}),
                },
            });
            if (!result?.ok) return null;
            const data = result.data as Record<string, unknown> | undefined;
            const manifest = data?.manifest && typeof data.manifest === 'object' ? data.manifest as Record<string, unknown> : {};
            const path = typeof data?.path === 'string' ? data.path.trim() : '';
            const sha256 = typeof data?.sha256 === 'string' ? data.sha256.trim() : '';
            const homeServerIdentityId = typeof manifest.homeServerIdentityId === 'string' ? manifest.homeServerIdentityId.trim() : '';
            const createdAt = typeof manifest.createdAt === 'string' ? manifest.createdAt.trim() : '';
            const bytes = typeof data?.archiveBytes === 'number' && Number.isFinite(data.archiveBytes) && data.archiveBytes >= 0
                ? data.archiveBytes
                : null;
            if (!path || !sha256 || !homeServerIdentityId || !createdAt || bytes === null) return null;
            const backup = {
                path,
                bytes,
                sha256,
                homeServerIdentityId,
                createdAt,
                homeNeedsAttention: data?.homeNeedsAttention === true,
            };
            setLastOperation({ operation: 'backup', backup });
            refreshAfterMutation();
            return backup;
        }, [refreshAfterMutation, runPersonalHomeTask]),
        verifyPersonalHomeBackup: React.useCallback(async (input: Readonly<{ archivePath: string }>) => {
            const archivePath = input.archivePath.trim();
            if (!archivePath) return null;
            const result = await runPersonalHomeTask('relay.runtime.personal_home.verify_backup.v1', { personalHomeOperation: { archivePath } });
            if (!result?.ok) {
                setLastVerification(null);
                return null;
            }
            const data = result.data as Record<string, unknown> | undefined;
            const manifest = data?.manifest && typeof data.manifest === 'object' ? data.manifest as Record<string, unknown> : {};
            const verification = {
                archivePath,
                identityMatchesCurrentHome: typeof data?.identityMatchesCurrentHome === 'string' ? data.identityMatchesCurrentHome : null,
                homeServerIdentityId: typeof manifest.homeServerIdentityId === 'string' ? manifest.homeServerIdentityId : null,
            };
            setLastVerification(verification);
            return verification;
        }, [runPersonalHomeTask]),
        restorePersonalHomeBackup: React.useCallback(async (input: Readonly<{ archivePath: string; overwriteConfirmed: boolean; verification: PersonalHomeVerification }>) => {
            const archivePath = input.archivePath.trim();
            if (input.verification.archivePath !== archivePath || (inspection?.destinationEmpty !== true && !input.overwriteConfirmed)) return null;
            const result = await runPersonalHomeTask('relay.runtime.personal_home.restore.v1', { personalHomeOperation: { archivePath, ...(input.overwriteConfirmed ? { confirmOverwrite: true } : {}) } });
            if (!result?.ok) return null;
            const data = result.data as Record<string, unknown> | undefined;
            const restore = {
                outcome: typeof data?.outcome === 'string' ? data.outcome : 'restored',
                rollbackPaths: Array.isArray(data?.rollbackPaths) ? data.rollbackPaths.filter((value): value is string => typeof value === 'string') : [],
                error: typeof data?.error === 'string' ? data.error : null,
            };
            setLastOperation({ operation: 'restore', restore });
            refreshAfterMutation();
            return restore;
        }, [inspection?.destinationEmpty, refreshAfterMutation, runPersonalHomeTask]),
        recoverPersonalHomeRestore: React.useCallback(async () => {
            if (inspection?.restoreRecovery.status !== 'rollback_available'
                && inspection?.restoreRecovery.status !== 'finalization_available') return null;
            const result = await runPersonalHomeTask('relay.runtime.personal_home.restore.v1', { personalHomeOperation: { action: 'recover' } });
            if (!result?.ok) return null;
            const data = result.data as Record<string, unknown> | undefined;
            const restore = {
                outcome: typeof data?.outcome === 'string' ? data.outcome : 'rolled_back',
                rollbackPaths: [] as readonly string[],
                error: typeof data?.error === 'string' ? data.error : null,
            };
            setLastOperation({ operation: 'restore', restore });
            refreshAfterMutation();
            return restore;
        }, [inspection?.restoreRecovery.status, refreshAfterMutation, runPersonalHomeTask]),
        finalizePersonalHomeRestore: React.useCallback(async () => {
            if (inspection?.restoreRecovery.status !== 'finalization_available') return null;
            const result = await runPersonalHomeTask('relay.runtime.personal_home.restore.v1', { personalHomeOperation: { action: 'finalize' } });
            if (!result?.ok) return null;
            const data = result.data as Record<string, unknown> | undefined;
            const restore = {
                outcome: typeof data?.outcome === 'string' ? data.outcome : 'finalized',
                rollbackPaths: [] as readonly string[],
                error: typeof data?.error === 'string' ? data.error : null,
            };
            setLastOperation({ operation: 'restore', restore });
            refreshAfterMutation();
            return {
                outcome: restore.outcome,
                removedPaths: Array.isArray(data?.removedPaths) ? data.removedPaths.filter((value): value is string => typeof value === 'string') : [],
                error: restore.error,
            };
        }, [inspection?.restoreRecovery.status, refreshAfterMutation, runPersonalHomeTask]),
        erasePersonalHomeData: React.useCallback(async () => {
            const result = await runPersonalHomeTask('relay.runtime.personal_home.erase.v1');
            if (!result?.ok) return null;
            const data = result.data as Record<string, unknown> | undefined;
            const erase = {
                removedPaths: Array.isArray(data?.removedPaths) ? data.removedPaths.filter((value): value is string => typeof value === 'string') : [],
                remainingUnknownPaths: Array.isArray(data?.remainingUnknownPaths) ? data.remainingUnknownPaths.filter((value): value is string => typeof value === 'string') : [],
                stoppedRunningHome: data?.stoppedRunningHome === true,
            };
            setLastOperation({ operation: 'erase', erase });
            refreshAfterMutation();
            return erase;
        }, [refreshAfterMutation, runPersonalHomeTask]),
        inspection,
        lastOperation,
        lastVerification,
        operationSnapshot,
        activeOperationKind,
        refreshInspection,
        dismissOperationResult: React.useCallback(() => {
            setOperationTaskId(null);
            setActiveOperationKind(null);
            setLastOperation(null);
        }, []),
        cancelTask: React.useCallback(async (taskId: string) => {
            await runner.cancel(taskId);
        }, [runner]),
        respondToTaskPrompt: React.useCallback(async (taskId: string, answer: unknown) => {
            await runner.respond(taskId, answer);
        }, [runner]),
        installOrUpdate: React.useCallback(async () => {
            await runAction('relay.runtime.installOrUpdate.v1');
        }, [runAction]),
        isBusy,
        isUnavailable,
        lastErrorMessage,
        refreshStatus,
        startRelay: React.useCallback(async () => {
            await runAction('relay.runtime.start.v1');
        }, [runAction]),
        restartRelay: React.useCallback(async () => {
            await runAction('relay.runtime.restart.v1');
        }, [runAction]),
        status: lastStatus,
        stopRelay: React.useCallback(async () => {
            await runAction('relay.runtime.stop.v1');
        }, [runAction]),
    };
}
