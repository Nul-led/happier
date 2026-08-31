import * as React from 'react';
import { View } from 'react-native';

import { Modal } from '@/modal';
import { SystemTaskProgressCard } from '@/components/systemTasks';
import { readLatestSystemTaskPrompt } from '@/components/systemTasks/prompts/readLatestSystemTaskPrompt';
import type { SystemTaskRunner } from '@/components/systemTasks/types';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text } from '@/components/ui/text/Text';
import { tLoose } from '@/text';
import { normalizeHappierRuntimePath } from '@happier-dev/cli-common/happierRuntime';
import { LocalRelayRuntimeControlSection } from './LocalRelayRuntimeControlSection';
import { useLocalRelayRuntimeControl } from './useLocalRelayRuntimeControl';
import { canCancelPersonalHomeOperationProgress } from './personalHomeOperationCancellation';
import type { HomeMemorySearchReadiness } from '@/sync/domains/memory/useMemorySearchProvider';

export type PersonalHomeRuntimeControlOperations = Readonly<{
    removeProfile?: () => Promise<void>;
    uninstallRuntime?: () => Promise<void>;
    openDataLocation?: (path: string) => Promise<void>;
    openLogs?: (path: string) => Promise<void>;
    revealBackupOutput?: (path: string) => Promise<void>;
}>;

function copy(key: string, fallback: string): string {
    const value = tLoose(`personalHome.settings.${key}`);
    return value === `personalHome.settings.${key}` ? fallback : value;
}

function formatBytes(bytes: number | null): string {
    if (bytes == null) return copy('unknownSize', 'Unknown size');
    if (bytes < 1024) return `${bytes.toFixed(1)} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatTimestamp(value: string | null): string {
    if (!value) return copy('unknownTimestamp', 'Timestamp unknown');
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? copy('unknownTimestamp', 'Timestamp unknown') : parsed.toISOString();
}

function searchReadinessLabel(readiness: HomeMemorySearchReadiness): string {
    switch (readiness) {
        case 'ready': return copy('searchReady', 'Search ready');
        case 'indexing': return copy('searchIndexing', 'Search indexing');
        case 'unavailable': return copy('searchUnavailable', 'Search unavailable');
        case 'unknown': return copy('searchUnknown', 'Search unknown');
    }
}

async function runExternalOperation(run: () => Promise<void>): Promise<void> {
    try {
        await run();
    } catch (error) {
        await Modal.alert(tLoose('common.error'), error instanceof Error ? error.message : String(error));
    }
}

async function confirmExternalOperation(title: string, body: string, action: string, run: () => Promise<void>): Promise<void> {
    if (!await Modal.confirm(title, body, { confirmText: action, destructive: true })) return;
    try { await run(); } catch (error) {
        await Modal.alert(tLoose('common.error'), error instanceof Error ? error.message : String(error));
    }
}

export const PersonalHomeRuntimeControlSection = React.memo(function PersonalHomeRuntimeControlSection(props: Readonly<{
    runner?: SystemTaskRunner;
    operations?: PersonalHomeRuntimeControlOperations;
    searchReadiness?: HomeMemorySearchReadiness;
    onStatusChange?: React.ComponentProps<typeof LocalRelayRuntimeControlSection>['onStatusChange'];
}>) {
    const control = useLocalRelayRuntimeControl({ ...(props.runner ? { runner: props.runner } : {}) });

    React.useEffect(() => {
        if (!control.isUnavailable && control.status?.purpose?.kind === 'personal-home') void control.refreshInspection();
        // refreshInspection is stable for the lifetime of the selected runner.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [control.isUnavailable, control.status?.purpose]);

    const backup = React.useCallback(async () => {
        const disclosed = await Modal.confirm(
            copy('backupDisclosureTitle', 'Back up this Personal Home?'),
            copy('backupDisclosureBody', 'This plaintext backup contains readable conversations, Home data, the Home access secret, and trusted-device state. Anyone who can restore it can operate a clone. Save it somewhere you trust.'),
            { confirmText: copy('backupAction', 'Back Up Now') },
        );
        if (!disclosed) return false;
        const outputPath = await Modal.prompt(copy('backupDestinationTitle', 'Backup destination'), copy('backupDestinationBody', 'Leave blank to use the default backup location.'), { placeholder: copy('backupDestinationPlaceholder', 'Optional archive path'), confirmText: tLoose('common.continue') });
        if (outputPath === null) return false;
        return await control.backupPersonalHome({ ...(outputPath.trim() ? { outputPath: outputPath.trim() } : {}) }) !== null;
    }, [control]);

    const restore = React.useCallback(async () => {
        const archivePath = (await Modal.prompt(copy('restoreArchiveTitle', 'Choose a Home backup'), copy('restoreArchiveBody', 'Enter the path to a Personal Home backup archive.'), { placeholder: copy('restoreArchivePlaceholder', 'Backup archive path'), confirmText: tLoose('common.continue') }))?.trim();
        if (!archivePath) return;
        const verified = await control.verifyPersonalHomeBackup({ archivePath });
        if (!verified) return;
        const overwriteNeeded = control.inspection?.destinationEmpty !== true;
        if (overwriteNeeded && !await Modal.confirm(copy('restoreConfirmTitle', 'Restore this Personal Home?'), copy('restoreConfirmBody', `Verified backup for ${verified.homeServerIdentityId ?? 'this Home'}. Existing data will be retained for rollback before replacement.`), { confirmText: copy('restoreAction', 'Restore'), destructive: true })) return;
        await control.restorePersonalHomeBackup({ archivePath, overwriteConfirmed: overwriteNeeded, verification: verified });
    }, [control]);

    const verify = React.useCallback(async () => {
        const archivePath = (await Modal.prompt(copy('verifyArchiveTitle', 'Verify a Home backup'), copy('verifyArchiveBody', 'Enter the path to a Personal Home backup archive.'), { placeholder: copy('restoreArchivePlaceholder', 'Backup archive path'), confirmText: copy('verifyAction', 'Verify Backup') }))?.trim();
        if (archivePath) await control.verifyPersonalHomeBackup({ archivePath });
    }, [control]);

    const erase = React.useCallback(async () => {
        const backUpFirst = await Modal.confirm(
            copy('eraseBackupOfferTitle', 'Back up before deleting?'),
            copy('eraseBackupOfferBody', 'You can create and verify a plaintext Personal Home backup before choosing whether to delete the current data.'),
            { confirmText: copy('eraseBackupOfferAction', 'Back Up First') },
        );
        if (backUpFirst) {
            const outputPath = (await Modal.prompt(
                copy('eraseBackupDestinationTitle', 'Save the safety backup outside this Home'),
                copy('eraseBackupDestinationBody', 'Enter an explicit archive path outside the Personal Home data, backups, and configuration. This path will remain after Home data is deleted.'),
                { placeholder: copy('eraseBackupDestinationPlaceholder', 'External backup archive path'), confirmText: copy('eraseBackupOfferAction', 'Back Up First') },
            ))?.trim();
            if (!outputPath) return;
            const safetyBackup = await control.backupPersonalHome({ outputPath, intent: 'erase-safety' });
            const requestedPath = normalizeHappierRuntimePath(outputPath);
            const verifiedPath = normalizeHappierRuntimePath(safetyBackup?.path);
            const windowsPath = /^[a-z]:\//iu.test(requestedPath) || requestedPath.startsWith('//');
            const exactPathMatches = windowsPath
                ? requestedPath.toLowerCase() === verifiedPath.toLowerCase()
                : requestedPath === verifiedPath;
            if (!safetyBackup || !requestedPath || !exactPathMatches) {
                await Modal.alert(tLoose('common.error'), copy('eraseBackupUnsafe', 'The safety backup was not verified at an external destination. Home data was not deleted.'));
                return;
            }
            await Modal.alert(
                copy('eraseBackupVerifiedTitle', 'Safety backup verified'),
                `${copy('eraseBackupVerifiedBody', 'The verified backup will remain at:')}\n\n${safetyBackup.path}`,
            );
        }
        await control.erasePersonalHomeData();
    }, [control]);

    const recoverRestore = React.useCallback(async () => {
        const targets = control.inspection?.restoreRecovery.affectedTargets ?? [];
        const status = control.inspection?.restoreRecovery.status;
        if ((status !== 'rollback_available' && status !== 'finalization_available') || targets.length === 0) return;
        const confirmed = await Modal.confirm(
            status === 'finalization_available'
                ? copy('rollbackCompletedRestoreTitle', 'Roll back the completed restore?')
                : copy('recoverRestoreTitle', 'Recover interrupted restore?'),
            `${status === 'finalization_available'
                ? copy('rollbackCompletedRestoreBody', 'Replace the restored Home with the retained previous data for these targets:')
                : copy('recoverRestoreBody', 'Roll back the interrupted restore using retained recovery material for these targets:')}\n\n${targets.map((target) => `• ${target}`).join('\n')}`,
            { confirmText: copy('recoverRestoreAction', 'Recover Restore'), destructive: true },
        );
        if (confirmed) await control.recoverPersonalHomeRestore();
    }, [control]);

    const finalizeRestore = React.useCallback(async () => {
        const targets = control.inspection?.restoreRecovery.affectedTargets ?? [];
        if (control.inspection?.restoreRecovery.status !== 'finalization_available' || targets.length === 0) return;
        const confirmed = await Modal.confirm(
            copy('finalizeRestoreTitle', 'Finalize this restore?'),
            `${copy('finalizeRestoreBody', 'The restored Home stays active. Retained rollback material for these targets will be permanently removed:')}\n\n${targets.map((target) => `• ${target}`).join('\n')}`,
            { confirmText: copy('finalizeRestoreAction', 'Finalize Restore'), destructive: true },
        );
        if (confirmed) await control.finalizePersonalHomeRestore();
    }, [control]);

    const handledErasePromptRef = React.useRef<string | null>(null);
    const operationPrompt = readLatestSystemTaskPrompt(control.operationSnapshot);
    React.useEffect(() => {
        if (!control.operationSnapshot?.awaitingInput
            || operationPrompt?.kind !== 'personal_home.confirm_erase.v1') return;
        const promptKey = `${control.operationSnapshot.taskId}:${JSON.stringify(operationPrompt.data)}`;
        if (handledErasePromptRef.current === promptKey) return;
        handledErasePromptRef.current = promptKey;
        const taskId = control.operationSnapshot.taskId;
        void (async () => {
            const rawPaths = operationPrompt.data.paths;
            const paths = Array.isArray(rawPaths)
                ? rawPaths.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                : [];
            const estimatedBytes = typeof operationPrompt.data.estimatedBytes === 'number'
                && Number.isFinite(operationPrompt.data.estimatedBytes)
                && operationPrompt.data.estimatedBytes >= 0
                ? operationPrompt.data.estimatedBytes
                : null;
            let confirmed = false;
            try {
                if (Array.isArray(rawPaths) && paths.length > 0 && paths.length === rawPaths.length) {
                    confirmed = await Modal.confirm(
                        copy('eraseDataTitle', 'Delete Personal Home data?'),
                        `${copy('eraseDataBody', 'This is separate from uninstall and permanently deletes only these resolved Home paths:')}\n\n${paths.map((path) => `• ${path}`).join('\n')}\n\n${copy('estimatedSize', 'Estimated size')}: ${formatBytes(estimatedBytes)}`,
                        { confirmText: tLoose('common.delete'), destructive: true },
                    );
                }
            } finally {
                await control.respondToTaskPrompt(taskId, { confirmed });
            }
        })().catch(() => {});
    }, [control, operationPrompt]);

    const disabled = control.isBusy || control.isUnavailable || control.status?.purpose?.kind !== 'personal-home';
    const backupResult = control.lastOperation?.operation === 'backup' ? control.lastOperation.backup : null;
    const restoreResult = control.lastOperation?.operation === 'restore' ? control.lastOperation.restore : null;
    const eraseResult = control.lastOperation?.operation === 'erase' ? control.lastOperation.erase : null;
    const operations = props.operations;
    const latestBackup = control.inspection?.latestBackup ?? null;
    const canCancel = control.operationSnapshot?.result == null
        && canCancelPersonalHomeOperationProgress(control.activeOperationKind, control.operationSnapshot?.currentStepId ?? null);

    return <>
        <LocalRelayRuntimeControlSection {...(props.runner ? { runner: props.runner } : {})} controller={control} onStatusChange={props.onStatusChange} showProgress={false} />
        <ItemGroup title={copy('overviewTitle', 'Overview')} footer={copy('footer', 'Your Home stays on this computer. These actions do not change another Home.')}>
            <Item testID="settings.personalHomeRuntime.identity" title={copy('identityTitle', 'Home identity')} subtitle={control.inspection?.homeServerIdentityId ?? copy('notAvailable', 'Not available')} showChevron={false} mode="info" />
            <Item testID="settings.personalHomeRuntime.storage" title={copy('storageTitle', 'Storage')} subtitle={formatBytes(control.inspection?.databaseBytes ?? null)} showChevron={false} mode="info" />
            <Item testID="settings.personalHomeRuntime.backupsCount" title={copy('backupsTitle', 'Backup archives')} subtitle={String(control.inspection?.backupsCount ?? 0)} showChevron={false} mode="info" />
            <Item testID="settings.personalHomeRuntime.search" title={copy('searchTitle', 'Search')} subtitle={searchReadinessLabel(props.searchReadiness ?? 'unknown')} showChevron={false} mode="info" />
            <Item testID="settings.personalHomeRuntime.lastBackup" title={copy('lastBackupTitle', 'Last backup')} subtitle={latestBackup ? `${formatTimestamp(latestBackup.createdAt)} · ${formatBytes(latestBackup.archiveBytes)}` : copy('lastBackupUnknown', 'Last backup unknown')} showChevron={false} mode="info" />
            <Item testID="settings.personalHomeRuntime.masterSecret" title={copy('masterSecretTitle', 'Home access secret')} subtitle={control.inspection?.masterSecretPresent ? copy('masterSecretPresent', 'Present') : copy('masterSecretUnavailable', 'Not available')} showChevron={false} mode="info" />
            <Item testID="settings.personalHomeRuntime.inspect" title={copy('inspectAction', 'Refresh Home details')} onPress={() => void control.refreshInspection()} disabled={disabled} />
            <Item testID="settings.personalHomeRuntime.restart" title={copy('restartAction', 'Restart Personal Home')} onPress={() => void control.restartRelay()} disabled={disabled} />
        </ItemGroup>
        <ItemGroup title={copy('backupsSectionTitle', 'Backups')} footer={copy('backupsSectionFooter', 'Backups are readable archives. Store them only in a location you trust.')}>
            <Item testID="settings.personalHomeRuntime.backup" title={copy('backupAction', 'Back Up Now')} subtitle={copy('backupSubtitle', 'Creates and verifies a plaintext Home archive.')} onPress={() => void backup()} disabled={disabled} />
            <Item testID="settings.personalHomeRuntime.verifyBackup" title={copy('verifyAction', 'Verify Backup…')} subtitle={copy('verifySubtitle', 'Checks an archive without restoring it.')} onPress={() => void verify()} disabled={disabled} />
            <Item testID="settings.personalHomeRuntime.restore" title={copy('restoreAction', 'Restore…')} subtitle={copy('restoreSubtitle', 'Validates a backup before replacing Home data.')} onPress={() => void restore()} disabled={disabled} />
            {control.inspection?.restoreRecovery.status === 'rollback_available' || control.inspection?.restoreRecovery.status === 'finalization_available' ? <Item testID="settings.personalHomeRuntime.recoverRestore" title={control.inspection.restoreRecovery.status === 'finalization_available' ? copy('rollbackCompletedRestoreAction', 'Roll Back Completed Restore') : copy('recoverRestoreAction', 'Recover Restore')} subtitle={control.inspection.restoreRecovery.status === 'finalization_available' ? copy('rollbackCompletedRestoreSubtitle', 'Restore the previous Home from retained rollback material.') : copy('recoverRestoreSubtitle', 'An interrupted restore can be rolled back explicitly.')} onPress={() => void recoverRestore()} disabled={disabled} destructive /> : null}
            {control.inspection?.restoreRecovery.status === 'finalization_available' ? <Item testID="settings.personalHomeRuntime.finalizeRestore" title={copy('finalizeRestoreAction', 'Finalize Restore')} subtitle={copy('finalizeRestoreSubtitle', 'Keep the restored Home and permanently remove retained rollback material.')} onPress={() => void finalizeRestore()} disabled={disabled} destructive /> : null}
            {control.inspection?.restoreRecovery.status === 'ambiguous' ? <Item testID="settings.personalHomeRuntime.restoreRecoveryWarning" title={copy('restoreRecoveryWarningTitle', 'Restore needs repair')} subtitle={copy('restoreRecoveryWarningBody', 'Recovery state is ambiguous. No automatic change will be made. Review diagnostics before repairing this Home.')} showChevron={false} mode="info" /> : null}
            {backupResult ? <Item testID="settings.personalHomeRuntime.backupResult" title={copy('backupVerified', 'Backup verified')} subtitle={[backupResult.path, formatBytes(backupResult.bytes), backupResult.homeServerIdentityId, formatTimestamp(backupResult.createdAt), backupResult.homeNeedsAttention ? copy('backupNeedsAttention', 'Backup verified; Home restart needs attention') : copy('backupHomeReady', 'Home restarted')].join(' · ')} showChevron={false} mode="info" /> : null}
            {backupResult && operations?.revealBackupOutput ? <Item testID="settings.personalHomeRuntime.backupReveal" title={copy('backupRevealAction', 'Reveal backup')} onPress={() => void runExternalOperation(() => operations.revealBackupOutput!(backupResult.path))} /> : null}
            {control.lastVerification ? <Item testID="settings.personalHomeRuntime.verifyResult" title={copy('backupVerified', 'Backup verified')} subtitle={`${control.lastVerification.archivePath} · ${control.lastVerification.homeServerIdentityId ?? copy('identityUnavailable', 'Identity unavailable')} · ${control.lastVerification.identityMatchesCurrentHome ?? copy('identityComparisonUnavailable', 'Identity comparison unavailable')}`} showChevron={false} mode="info" /> : null}
            {restoreResult ? <Item testID="settings.personalHomeRuntime.restoreResult" title={copy('restoreResultTitle', 'Restore result')} subtitle={[(restoreResult.outcome === 'recovery_required' ? copy('restoreOutcomeRecoveryRequired', 'Recovery needed') : restoreResult.outcome === 'rolled_back' ? copy('restoreOutcomeRolledBack', 'Restore rolled back') : copy('restoreOutcomeRestored', 'Home restored')), restoreResult.error, ...restoreResult.rollbackPaths.map((path) => `${copy('rollbackRetainedAt', 'Rollback retained at')}: ${path}`)].filter(Boolean).join('\n')} showChevron={false} mode="info" /> : null}
        </ItemGroup>
        <ItemGroup title={copy('storageRelocationTitle', 'Storage & Relocation')} footer={copy('storageRelocationFooter', 'Move Home becomes available when a supported destination can be selected and verified.')}>
            <Item testID="settings.personalHomeRuntime.relocate" title={copy('relocateAction', 'Move This Home…')} subtitle={copy('relocateUnavailableSubtitle', 'Unavailable until a supported destination can be selected.')} disabled showChevron={false} />
            {operations?.openDataLocation ? <Item testID="settings.personalHomeRuntime.openDataLocation" title={copy('openDataLocationAction', 'Open Home data location')} onPress={() => void runExternalOperation(() => operations.openDataLocation!(control.inspection?.layoutPaths.dataDir ?? ''))} disabled={!control.inspection?.layoutPaths.dataDir} /> : null}
            {operations?.openLogs ? <Item testID="settings.personalHomeRuntime.openLogs" title={copy('openLogsAction', 'Open runtime logs')} onPress={() => void runExternalOperation(() => operations.openLogs!(control.inspection?.layoutPaths.logsDir ?? ''))} disabled={!control.inspection?.layoutPaths.logsDir} /> : null}
        </ItemGroup>
        <ItemGroup title={copy('removeSectionTitle', 'Remove Personal Home')} footer={copy('removeSectionFooter', 'Uninstall keeps Home data. Permanent deletion is a separate confirmed action.')}>
            {operations?.removeProfile ? <Item testID="settings.personalHomeRuntime.removeProfile" title={copy('removeProfileAction', 'Remove Home from Happier')} subtitle={copy('removeProfileSubtitle', 'Removes this profile; runtime data stays on this computer.')} onPress={() => void confirmExternalOperation(copy('removeProfileTitle', 'Remove Personal Home profile?'), copy('removeProfileBody', 'This removes the profile but keeps the runtime and data.'), tLoose('common.remove'), operations.removeProfile!)} destructive /> : null}
            {operations?.uninstallRuntime ? <Item testID="settings.personalHomeRuntime.uninstallRuntime" title={copy('uninstallRuntimeAction', 'Uninstall runtime, keep data')} subtitle={copy('uninstallRuntimeSubtitle', 'Removes the service and binaries; Home data is preserved.')} onPress={() => void confirmExternalOperation(copy('uninstallRuntimeTitle', 'Uninstall Personal Home runtime?'), copy('uninstallRuntimeBody', 'The database, files, Home access secret, and backups remain.'), tLoose('common.uninstall'), operations.uninstallRuntime!)} destructive /> : null}
            <Item testID="settings.personalHomeRuntime.eraseData" title={copy('eraseDataAction', 'Delete Personal Home data permanently')} subtitle={copy('eraseDataSubtitle', 'Separate from uninstall. Permanently deletes the resolved Home data.')} onPress={() => void erase()} disabled={disabled} destructive />
            {eraseResult ? <Item testID="settings.personalHomeRuntime.eraseResult" title={copy('eraseResultTitle', 'Home data deleted')} subtitle={[`${eraseResult.removedPaths.length} ${copy('pathsRemoved', 'paths removed')}`, eraseResult.stoppedRunningHome ? copy('eraseStoppedHome', 'Running Home was stopped') : copy('eraseHomeAlreadyStopped', 'Home was already stopped'), ...(eraseResult.remainingUnknownPaths.length > 0 ? [`${copy('eraseRemainingPaths', 'Could not remove')}: ${eraseResult.remainingUnknownPaths.join(', ')}`] : [])].join('\n')} showChevron={false} mode="info" /> : null}
        </ItemGroup>
        {control.operationSnapshot ? <View>
            {control.operationSnapshot.status === 'failed' ? <Text testID="system-task-a11y-failure" accessibilityLiveRegion="assertive">{control.operationSnapshot.latestMessage}</Text> : control.operationSnapshot.result ? null : <Text testID="system-task-a11y-progress" accessibilityLiveRegion="polite">{control.operationSnapshot.latestMessage}</Text>}
            <SystemTaskProgressCard title={copy('progressTitle', 'Personal Home operation')} snapshot={control.operationSnapshot} {...(canCancel ? { onCancel: () => void control.cancelTask(control.operationSnapshot!.taskId) } : {})} />
            {control.operationSnapshot.result ? <Item testID="settings.personalHomeRuntime.dismissResult" title={copy('dismissResult', 'Dismiss')} onPress={control.dismissOperationResult} /> : null}
        </View> : null}
    </>;
});
