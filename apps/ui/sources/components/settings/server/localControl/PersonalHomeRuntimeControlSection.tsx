import * as React from 'react';
import { View } from 'react-native';
import type { SystemTaskSpec } from '@happier-dev/protocol';

import { Modal } from '@/modal';
import { SystemTaskProgressCard } from '@/components/systemTasks';
import { readLatestSystemTaskPrompt } from '@/components/systemTasks/prompts/readLatestSystemTaskPrompt';
import type { SystemTaskRunner } from '@/components/systemTasks/types';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text } from '@/components/ui/text/Text';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { getPreferredLanguage, t, tLoose } from '@/text';
import { formatWithCachedDateTimeFormatter } from '@/utils/datetime/cachedIntlFormatters';
import { formatByteSize } from '@/utils/files/formatByteSize';
import { useLocalRelayRuntimeControl } from './useLocalRelayRuntimeControl';
import { canCancelPersonalHomeOperationProgress } from './personalHomeOperationCancellation';
import type { HomeMemorySearchReadiness } from '@/sync/domains/memory/useMemorySearchProvider';
import type { SystemTaskPromptEnvelope } from '@/components/systemTasks/prompts/readLatestSystemTaskPrompt';

export type PersonalHomeRelocationDestination = Readonly<{
    id: string;
    title: string;
    subtitle?: string;
}>;

export type PreparedPersonalHomeRelocationTask = Readonly<{
    spec: SystemTaskSpec;
    respondToPrompt: (prompt: SystemTaskPromptEnvelope) => Promise<unknown>;
}>;

export type PersonalHomeRelocationRecovery = Readonly<{
    operationId: string;
    destinationMachineId: string;
    sourceDescriptorRevision: number;
    recoveryAction: 'finish_move' | 'return_to_source';
}>;

export type PersonalHomeRuntimeControlOperations = Readonly<{
    removeProfile?: () => Promise<void>;
    uninstallRuntime?: () => Promise<void>;
    openDataLocation?: (path: string) => Promise<void>;
    openLogs?: (path: string) => Promise<void>;
    revealBackupOutput?: (path: string) => Promise<void>;
    selectBackupArchive?: () => Promise<string | null>;
    selectBackupExportDestination?: () => Promise<string | null>;
    relocation?: Readonly<{
        destinations: readonly PersonalHomeRelocationDestination[];
        prepare: (destinationId: string) => Promise<PreparedPersonalHomeRelocationTask>;
        prepareRecovery?: (recovery: PersonalHomeRelocationRecovery) => Promise<PreparedPersonalHomeRelocationTask>;
    }>;
}>;

function readPersonalHomeRelocationRecovery(value: unknown): PersonalHomeRelocationRecovery | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const data = value as Record<string, unknown>;
    const personalHome = data.personalHome;
    if (data.action !== 'personalHome.relocate' || !personalHome || typeof personalHome !== 'object' || Array.isArray(personalHome)) {
        return null;
    }
    const facts = personalHome as Record<string, unknown>;
    const operationId = typeof facts.operationId === 'string' ? facts.operationId.trim() : '';
    const destinationMachineId = typeof facts.destinationMachineId === 'string' ? facts.destinationMachineId.trim() : '';
    const sourceDescriptorRevision = facts.sourceDescriptorRevision;
    const recoveryAction = facts.recoveryAction;
    if (!operationId || !destinationMachineId || typeof sourceDescriptorRevision !== 'number'
        || !Number.isSafeInteger(sourceDescriptorRevision) || sourceDescriptorRevision < 1
        || (recoveryAction !== 'finish_move' && recoveryAction !== 'return_to_source')) {
        return null;
    }
    return { operationId, destinationMachineId, sourceDescriptorRevision, recoveryAction };
}

function copy(key: string, fallback: string): string {
    const value = tLoose(`personalHome.settings.${key}`);
    return value === `personalHome.settings.${key}` ? fallback : value;
}

function formatBytes(bytes: number | null): string {
    if (bytes == null) return copy('unknownSize', 'Unknown size');
    return formatByteSize(bytes);
}

function formatTimestamp(value: string | null): string {
    if (!value) return copy('unknownTimestamp', 'Timestamp unknown');
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? copy('unknownTimestamp', 'Timestamp unknown')
        : formatWithCachedDateTimeFormatter(parsed, getPreferredLanguage(), { dateStyle: 'medium', timeStyle: 'short' });
}

function resolveRuntimeStatusSubtitle(control: ReturnType<typeof useLocalRelayRuntimeControl>): string {
    if (control.isUnavailable) return t('settings.systemTaskBridgeUnavailable');
    if (!control.status) return t('settings.localRelayRuntime.statusChecking');
    if (!control.status.installed) return t('settings.localRelayRuntime.statusNotInstalled');
    if (control.status.service.active !== true) return t('settings.localRelayRuntime.statusStopped');
    return control.status.healthy
        ? t('settings.localRelayRuntime.statusRunningHealthy')
        : t('settings.localRelayRuntime.statusRunningNeedsAttention');
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
    homeLabel?: string;
    searchReadiness?: HomeMemorySearchReadiness;
    onStatusChange?: (status: ReturnType<typeof useLocalRelayRuntimeControl>['status']) => void;
}>) {
    const control = useLocalRelayRuntimeControl({ ...(props.runner ? { runner: props.runner } : {}) });

    React.useEffect(() => {
        if (!control.isUnavailable && control.status?.purpose?.kind === 'personal-home') void control.refreshInspection();
        // refreshInspection is stable for the lifetime of the selected runner.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [control.isUnavailable, control.status?.purpose]);

    React.useEffect(() => {
        props.onStatusChange?.(control.status);
    }, [control.status, props.onStatusChange]);

    const backup = React.useCallback(async () => {
        return await control.backupPersonalHome() !== null;
    }, [control]);

    const exportBackup = React.useCallback(async () => {
        const outputPath = (await props.operations?.selectBackupExportDestination?.())?.trim();
        if (!outputPath) return;
        await control.backupPersonalHome({ outputPath });
    }, [control, props.operations]);

    const restore = React.useCallback(async () => {
        const archivePath = (await props.operations?.selectBackupArchive?.())?.trim();
        if (!archivePath) return;
        const verified = await control.verifyPersonalHomeBackup({ archivePath });
        if (!verified) return;
        const overwriteNeeded = control.inspection?.destinationEmpty !== true;
        if (overwriteNeeded) {
            const summary = [
                `${copy('restoreBackupTitle', 'Backup')}: ${archivePath}`,
                `${copy('identityTitle', 'Home identity')}: ${verified.homeServerIdentityId ?? copy('identityUnavailable', 'Identity unavailable')}`,
                `${copy('restoreBackupDate', 'Created')}: ${formatTimestamp(verified.createdAt)}`,
                `${copy('restoreCompatibility', 'Compatibility')}: ${verified.format === 'happier-personal-home-backup' && verified.version === 1 ? copy('restoreCompatible', 'Compatible') : copy('restoreCompatibilityVerified', 'Verified by this version')}`,
                verified.archiveBytes == null ? null : `${copy('restoreBackupSize', 'Size')}: ${formatBytes(verified.archiveBytes)}`,
                copy('restoreReplacementNotice', 'The current Home data will be replaced. A verified recovery backup will be retained.'),
            ].filter((value): value is string => value !== null).join('\n');
            if (!await Modal.confirm(
                copy('restoreConfirmTitle', 'Replace and restore this Personal Home?'),
                summary,
                { confirmText: copy('restoreAction', 'Replace and Restore'), destructive: true },
            )) return;
        }
        await control.restorePersonalHomeBackup({ archivePath, overwriteConfirmed: overwriteNeeded, verification: verified });
    }, [control, props.operations]);

    const verify = React.useCallback(async () => {
        const archivePath = (await props.operations?.selectBackupArchive?.())?.trim();
        if (archivePath) await control.verifyPersonalHomeBackup({ archivePath });
    }, [control, props.operations]);

    const erase = React.useCallback(async () => {
        await control.erasePersonalHomeData();
    }, [control]);

    const [relocationMenuOpen, setRelocationMenuOpen] = React.useState(false);
    const relocationResponderRef = React.useRef<Readonly<{
        taskId: string;
        respondToPrompt: PreparedPersonalHomeRelocationTask['respondToPrompt'];
    }> | null>(null);
    const handledRelocationPromptRef = React.useRef<string | null>(null);
    const startRelocationTask = React.useCallback(async (prepared: PreparedPersonalHomeRelocationTask) => {
        const taskId = await control.startExternalOperation(prepared.spec);
        if (taskId) {
            relocationResponderRef.current = { taskId, respondToPrompt: prepared.respondToPrompt };
            handledRelocationPromptRef.current = null;
        }
    }, [control]);
    const relocate = React.useCallback(async (destination: PersonalHomeRelocationDestination) => {
        const relocation = props.operations?.relocation;
        if (!relocation) return;
        const prepared = await relocation.prepare(destination.id);
        const accepted = await Modal.confirm(
            copy('relocateConfirmTitle', 'Move this Personal Home?'),
            `${copy('relocateConfirmBody', 'Your current Home will be stopped before its verified copy becomes active on the destination.')}`
                + `\n\n${copy('relocateDestination', 'Destination')}: ${destination.title}`,
            { confirmText: copy('relocateConfirmAction', 'Move Home'), destructive: true },
        );
        if (!accepted) return;
        await startRelocationTask(prepared);
    }, [props.operations?.relocation, startRelocationTask]);

    const recoverRestore = React.useCallback(async () => {
        const targets = control.inspection?.restoreRecovery.affectedTargets ?? [];
        const status = control.inspection?.restoreRecovery.status;
        if ((status !== 'rollback_available' && status !== 'finalization_available') || targets.length === 0) return;
        const confirmed = await Modal.confirm(
            status === 'finalization_available'
                ? copy('rollbackCompletedRestoreTitle', 'Roll back the completed restore?')
                : copy('recoverRestoreTitle', 'Recover interrupted restore?'),
            status === 'finalization_available'
                ? copy('rollbackCompletedRestoreBody', 'Replace the restored Home with the retained previous data.')
                : copy('recoverRestoreBody', 'Roll back the interrupted restore using retained recovery material.'),
            { confirmText: copy('recoverRestoreAction', 'Recover Restore'), destructive: true },
        );
        if (confirmed) await control.recoverPersonalHomeRestore();
    }, [control]);

    const finalizeRestore = React.useCallback(async () => {
        const targets = control.inspection?.restoreRecovery.affectedTargets ?? [];
        if (control.inspection?.restoreRecovery.status !== 'finalization_available' || targets.length === 0) return;
        const confirmed = await Modal.confirm(
            copy('finalizeRestoreTitle', 'Finalize this restore?'),
            copy('finalizeRestoreBody', 'The restored Home stays active. Retained rollback material will be permanently removed.'),
            { confirmText: copy('finalizeRestoreAction', 'Finalize Restore'), destructive: true },
        );
        if (confirmed) await control.finalizePersonalHomeRestore();
    }, [control]);

    const handledErasePromptRef = React.useRef<string | null>(null);
    const operationPrompt = readLatestSystemTaskPrompt(control.operationSnapshot);
    React.useEffect(() => {
        const responder = relocationResponderRef.current;
        const taskId = control.operationSnapshot?.taskId;
        if (!responder || !taskId || taskId !== responder.taskId || !operationPrompt || control.operationSnapshot?.result) return;
        if (operationPrompt.kind !== 'personal_home.publish_relocation_descriptor.v1'
            && operationPrompt.kind !== 'personal_home.read_relocation_descriptor.v1') return;
        const promptKey = `${taskId}:${operationPrompt.kind}:${JSON.stringify(operationPrompt.data)}`;
        if (handledRelocationPromptRef.current === promptKey) return;
        handledRelocationPromptRef.current = promptKey;
        void responder.respondToPrompt(operationPrompt)
            .then(async (answer) => await control.respondToTaskPrompt(taskId, answer))
            // A publication/readback failure must flow back through the task's
            // authority reconciliation. Never terminate the destructive task
            // process after the source may already be quarantined.
            .catch(async () => await control.respondToTaskPrompt(taskId, { descriptor: null }));
    }, [control, operationPrompt]);
    React.useEffect(() => {
        if (control.operationSnapshot?.result && relocationResponderRef.current?.taskId === control.operationSnapshot.taskId) {
            relocationResponderRef.current = null;
            handledRelocationPromptRef.current = null;
        }
    }, [control.operationSnapshot]);
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
            const canonicalServerUrl = typeof operationPrompt.data.canonicalServerUrl === 'string'
                ? operationPrompt.data.canonicalServerUrl.trim()
                : '';
            const homeServerIdentityId = operationPrompt.data.homeServerIdentityId === null
                || (typeof operationPrompt.data.homeServerIdentityId === 'string' && operationPrompt.data.homeServerIdentityId.trim().length > 0)
                ? operationPrompt.data.homeServerIdentityId
                : undefined;
            let confirmed = false;
            try {
                if (Array.isArray(rawPaths)
                    && paths.length > 0
                    && paths.length === rawPaths.length
                    && canonicalServerUrl
                    && homeServerIdentityId !== undefined) {
                    confirmed = await Modal.confirm(
                        copy('eraseDataTitle', 'Delete Personal Home data?'),
                        `${copy('eraseHomeTarget', 'Home')}: ${canonicalServerUrl}\n${copy('identityTitle', 'Home identity')}: ${homeServerIdentityId ?? copy('identityUnavailable', 'Identity unavailable')}\n\n${copy('eraseDataBody', 'This is separate from uninstall and permanently deletes only these resolved Home paths:')}\n\n${paths.map((path) => `• ${path}`).join('\n')}\n\n${copy('estimatedSize', 'Estimated size')}: ${formatBytes(estimatedBytes)}`,
                        { confirmText: tLoose('common.delete'), destructive: true },
                    );
                }
            } finally {
                await control.respondToTaskPrompt(taskId, { confirmed });
            }
        })().catch(() => {});
    }, [control, operationPrompt]);

    const disabled = control.isBusy || control.isUnavailable || control.status?.purpose?.kind !== 'personal-home';
    const terminalRelocationRecovery = control.operationSnapshot?.result?.ok
        ? readPersonalHomeRelocationRecovery(control.operationSnapshot.result.data)
        : null;
    const inspectionRelocationRecovery = control.inspection?.relocationRecovery ?? null;
    const finishRelocationRecovery = terminalRelocationRecovery?.recoveryAction === 'finish_move'
        ? terminalRelocationRecovery
        : inspectionRelocationRecovery
            ? {
                operationId: inspectionRelocationRecovery.operationId,
                destinationMachineId: inspectionRelocationRecovery.destinationMachineId,
                sourceDescriptorRevision: inspectionRelocationRecovery.sourceDescriptorRevision,
                recoveryAction: inspectionRelocationRecovery.primaryAction,
            }
            : null;
    const returnRelocationRecovery = terminalRelocationRecovery?.recoveryAction === 'return_to_source'
        ? terminalRelocationRecovery
        : inspectionRelocationRecovery
            ? {
                operationId: inspectionRelocationRecovery.operationId,
                destinationMachineId: inspectionRelocationRecovery.destinationMachineId,
                sourceDescriptorRevision: inspectionRelocationRecovery.sourceDescriptorRevision,
                recoveryAction: inspectionRelocationRecovery.secondaryAction,
            }
            : null;
    const recoverRelocation = React.useCallback(async (recovery: PersonalHomeRelocationRecovery) => {
        const relocation = props.operations?.relocation;
        if (!relocation?.prepareRecovery) return;
        await startRelocationTask(await relocation.prepareRecovery(recovery));
    }, [props.operations?.relocation, startRelocationTask]);
    const backupResult = control.lastOperation?.operation === 'backup' ? control.lastOperation.backup : null;
    const restoreResult = control.lastOperation?.operation === 'restore' ? control.lastOperation.restore : null;
    const restoreRecoveryBackup = restoreResult?.recoveryArchive ?? null;
    const eraseResult = control.lastOperation?.operation === 'erase' ? control.lastOperation.erase : null;
    const operations = props.operations;
    const relocationItems = React.useMemo<readonly DropdownMenuItem[]>(() => (
        operations?.relocation?.destinations.map((destination) => ({
            id: destination.id,
            title: destination.title,
            ...(destination.subtitle ? { subtitle: destination.subtitle } : {}),
        })) ?? []
    ), [operations?.relocation?.destinations]);
    const latestBackup = control.inspection?.latestBackup ?? null;
    const canCancel = control.operationSnapshot?.result == null
        && canCancelPersonalHomeOperationProgress(control.activeOperationKind, control.operationSnapshot?.currentStepId ?? null);

    const canStart = !control.isUnavailable && control.status?.installed === true && control.status.service.active !== true && !control.isBusy;
    const canStop = !control.isUnavailable && control.status?.service.active === true && !control.isBusy;
    const homeLabel = props.homeLabel?.trim() || copy('defaultHomeLabel', 'Personal Home');

    return <>
        <ItemGroup title={copy('summaryTitle', 'Personal Home')} footer={copy('footer', 'Your Home stays on this computer. These actions do not change another Home.')}>
            <Item testID="settings.localRelayRuntime.status" title={copy('statusTitle', 'Status')} subtitle={resolveRuntimeStatusSubtitle(control)} showChevron={false} mode="info" />
            <Item testID="settings.personalHomeRuntime.home" title={copy('homeTitle', 'Home')} subtitle={homeLabel} showChevron={false} mode="info" />
            {control.inspection ? <Item
                testID="settings.personalHomeRuntime.homeDetails"
                title={t('common.details')}
                onPress={() => void Modal.alert(t('common.details'), [
                    `${copy('homeTitle', 'Home')}: ${homeLabel}`,
                    `${copy('identityTitle', 'Home identity')}: ${control.inspection?.homeServerIdentityId ?? copy('identityUnavailable', 'Identity unavailable')}`,
                    `${copy('canonicalAddress', 'Address')}: ${control.status?.relayUrl ?? copy('notAvailable', 'Not available')}`,
                ].join('\n'))}
            /> : null}
            <Item testID="settings.personalHomeRuntime.storage" title={copy('storageTitle', 'Storage')} subtitle={formatBytes(control.inspection?.databaseBytes ?? null)} showChevron={false} mode="info" />
            <Item testID="settings.personalHomeRuntime.masterSecret" title={copy('masterSecretTitle', 'Home access secret')} subtitle={control.inspection?.masterSecretPresent ? copy('masterSecretPresent', 'Present') : copy('masterSecretUnavailable', 'Not available')} showChevron={false} mode="info" />
            <Item testID="settings.personalHomeRuntime.inspect" title={copy('inspectAction', 'Refresh Home details')} onPress={() => void control.refreshInspection()} disabled={disabled} />
        </ItemGroup>
        <ItemGroup title={copy('protectionTitle', 'Protection')} footer={copy('backupsSectionFooter', 'Backups contain readable conversations, Home data, trusted-device state, and the Home access secret. Store them only in a location you trust.')}>
            <Item testID="settings.personalHomeRuntime.lastBackup" title={copy('lastBackupTitle', 'Last backup')} subtitle={latestBackup ? `${formatTimestamp(latestBackup.createdAt)} · ${formatBytes(latestBackup.archiveBytes)}` : copy('lastBackupUnknown', 'Last backup unknown')} showChevron={false} mode="info" />
            <Item testID="settings.personalHomeRuntime.backupsCount" title={copy('backupsTitle', 'Backup archives')} subtitle={String(control.inspection?.backupsCount ?? 0)} showChevron={false} mode="info" />
            {props.searchReadiness === 'indexing' ? <Item testID="settings.personalHomeRuntime.search" title={copy('searchTitle', 'Search')} subtitle={copy('searchIndexing', 'Search indexing')} showChevron={false} mode="info" /> : null}
            <Item testID="settings.personalHomeRuntime.backup" title={copy('backupAction', 'Back Up Now')} subtitle={copy('backupSubtitle', 'Creates and verifies a plaintext Home archive.')} onPress={() => void backup()} disabled={disabled} />
            {operations?.selectBackupExportDestination ? <Item testID="settings.personalHomeRuntime.exportBackup" title={copy('exportBackupAction', 'Export Backup…')} subtitle={copy('exportBackupSubtitle', 'Creates a verified backup in a location you choose.')} onPress={() => void exportBackup()} disabled={disabled} /> : null}
            {operations?.selectBackupArchive ? <Item testID="settings.personalHomeRuntime.verifyBackup" title={copy('verifyAction', 'Verify Backup…')} subtitle={copy('verifySubtitle', 'Checks an archive without restoring it.')} onPress={() => void verify()} disabled={disabled} /> : null}
            {operations?.selectBackupArchive ? <Item testID="settings.personalHomeRuntime.restore" title={copy('restoreAction', 'Restore…')} subtitle={copy('restoreSubtitle', 'Validates a backup before replacing Home data.')} onPress={() => void restore()} disabled={disabled} /> : null}
            {relocationItems.length > 0 ? <DropdownMenu
                testID="settings.personalHomeRuntime.relocate"
                open={relocationMenuOpen}
                onOpenChange={setRelocationMenuOpen}
                items={relocationItems}
                onSelect={(destinationId) => {
                    setRelocationMenuOpen(false);
                    const destination = operations?.relocation?.destinations.find((candidate) => candidate.id === destinationId);
                    if (destination) void runExternalOperation(() => relocate(destination));
                }}
                itemTrigger={{
                    title: copy('relocateAction', 'Move Home…'),
                    subtitle: copy('relocateSubtitle', 'Move this Home to a managed computer.'),
                    itemProps: { disabled },
                }}
                placement="bottom"
                matchTriggerWidth={true}
            /> : null}
            {finishRelocationRecovery && operations?.relocation?.prepareRecovery ? <Item
                testID="settings.personalHomeRuntime.recoverRelocation"
                title={copy('relocationFinishAction', 'Finish Moving')}
                subtitle={copy('relocationFinishSubtitle', 'Finish moving this Home after the destination is verified.')}
                onPress={() => void runExternalOperation(() => recoverRelocation(finishRelocationRecovery))}
                disabled={disabled}
            /> : null}
            {control.inspection?.restoreRecovery.status === 'rollback_available' || control.inspection?.restoreRecovery.status === 'finalization_available' ? <Item testID="settings.personalHomeRuntime.recoverRestore" title={control.inspection.restoreRecovery.status === 'finalization_available' ? copy('rollbackCompletedRestoreAction', 'Roll Back Completed Restore') : copy('recoverRestoreAction', 'Recover Restore')} subtitle={control.inspection.restoreRecovery.status === 'finalization_available' ? copy('rollbackCompletedRestoreSubtitle', 'Restore the previous Home from retained rollback material.') : copy('recoverRestoreSubtitle', 'An interrupted restore can be rolled back explicitly.')} onPress={() => void recoverRestore()} disabled={disabled} destructive /> : null}
            {control.inspection?.restoreRecovery.status === 'finalization_available' ? <Item testID="settings.personalHomeRuntime.finalizeRestore" title={copy('finalizeRestoreAction', 'Finalize Restore')} subtitle={copy('finalizeRestoreSubtitle', 'Keep the restored Home and permanently remove retained rollback material.')} onPress={() => void finalizeRestore()} disabled={disabled} destructive /> : null}
            {control.inspection?.restoreRecovery.status === 'ambiguous' ? <Item testID="settings.personalHomeRuntime.restoreRecoveryWarning" title={copy('restoreRecoveryWarningTitle', 'Restore needs repair')} subtitle={copy('restoreRecoveryWarningBody', 'Recovery state is ambiguous. No automatic change will be made. Review diagnostics before repairing this Home.')} showChevron={false} mode="info" /> : null}
            {backupResult ? <Item testID="settings.personalHomeRuntime.backupResult" title={copy('backupVerified', 'Backup verified')} subtitle={[formatTimestamp(backupResult.createdAt), formatBytes(backupResult.bytes), backupResult.homeNeedsAttention ? copy('backupNeedsAttention', 'Backup verified; Home restart needs attention') : copy('backupHomeReady', 'Home restarted')].join(' · ')} showChevron={false} mode="info" /> : null}
            {backupResult ? <Item
                testID="settings.personalHomeRuntime.backupResultDetails"
                title={t('common.details')}
                onPress={() => void Modal.alert(t('common.details'), [
                    `${copy('restoreBackupTitle', 'Backup')}: ${backupResult.path}`,
                    `${copy('restoreBackupDate', 'Created')}: ${formatTimestamp(backupResult.createdAt)}`,
                    `${copy('restoreBackupSize', 'Size')}: ${formatBytes(backupResult.bytes)}`,
                    `${copy('identityTitle', 'Home identity')}: ${backupResult.homeServerIdentityId}`,
                    `SHA-256: ${backupResult.sha256}`,
                    copy('backupVerified', 'Backup verified'),
                ].join('\n'))}
            /> : null}
            {backupResult && operations?.revealBackupOutput ? <Item testID="settings.personalHomeRuntime.backupReveal" title={copy('backupRevealAction', 'Reveal backup')} onPress={() => void runExternalOperation(() => operations.revealBackupOutput!(backupResult.path))} /> : null}
            {control.lastVerification ? <Item testID="settings.personalHomeRuntime.verifyResult" title={copy('backupVerified', 'Backup verified')} subtitle={[formatTimestamp(control.lastVerification.createdAt), control.lastVerification.archiveBytes === null ? null : formatBytes(control.lastVerification.archiveBytes)].filter((value): value is string => value !== null).join(' · ')} showChevron={false} mode="info" /> : null}
            {control.lastVerification ? <Item
                testID="settings.personalHomeRuntime.verifyResultDetails"
                title={t('common.details')}
                onPress={() => void Modal.alert(t('common.details'), [
                    `${copy('restoreBackupTitle', 'Backup')}: ${control.lastVerification?.archivePath}`,
                    `${copy('restoreBackupDate', 'Created')}: ${formatTimestamp(control.lastVerification?.createdAt ?? null)}`,
                    `${copy('restoreBackupSize', 'Size')}: ${formatBytes(control.lastVerification?.archiveBytes ?? null)}`,
                    `${copy('identityTitle', 'Home identity')}: ${control.lastVerification?.homeServerIdentityId ?? copy('identityUnavailable', 'Identity unavailable')}`,
                    `${copy('restoreCompatibility', 'Compatibility')}: ${control.lastVerification?.format ?? copy('notAvailable', 'Not available')} v${control.lastVerification?.version ?? '?'}`,
                    `${copy('identityComparison', 'Current Home')}: ${control.lastVerification?.identityMatchesCurrentHome ?? copy('identityComparisonUnavailable', 'Identity comparison unavailable')}`,
                ].join('\n'))}
            /> : null}
            {restoreResult ? <Item testID="settings.personalHomeRuntime.restoreResult" title={copy('restoreResultTitle', 'Restore result')} subtitle={[(restoreResult.outcome === 'recovery_required' ? copy('restoreOutcomeRecoveryRequired', 'Recovery needed') : restoreResult.outcome === 'rolled_back' ? copy('restoreOutcomeRolledBack', 'Restore rolled back') : copy('restoreOutcomeRestored', 'Home restored')), restoreResult.error].filter(Boolean).join('\n')} showChevron={false} mode="info" /> : null}
            {restoreRecoveryBackup ? <Item
                testID="settings.personalHomeRuntime.restoreRecoveryBackup"
                title={copy('backupVerified', 'Backup verified')}
                subtitle={`${formatTimestamp(restoreRecoveryBackup.createdAt)} · ${formatBytes(restoreRecoveryBackup.bytes)} · ${copy('backupVerified', 'Backup verified')}`}
                showChevron={false}
                mode="info"
            /> : null}
            {restoreRecoveryBackup ? <Item
                testID="settings.personalHomeRuntime.restoreRecoveryBackupDetails"
                title={t('common.details')}
                onPress={() => void Modal.alert(t('common.details'), [
                    `${copy('restoreBackupTitle', 'Backup')}: ${restoreRecoveryBackup.path}`,
                    `${copy('restoreBackupDate', 'Created')}: ${formatTimestamp(restoreRecoveryBackup.createdAt)}`,
                    `${copy('restoreBackupSize', 'Size')}: ${formatBytes(restoreRecoveryBackup.bytes)}`,
                    `${copy('identityTitle', 'Home identity')}: ${restoreRecoveryBackup.homeServerIdentityId}`,
                    `SHA-256: ${restoreRecoveryBackup.sha256}`,
                    copy('backupVerified', 'Backup verified'),
                ].join('\n'))}
            /> : null}
            {restoreRecoveryBackup && operations?.revealBackupOutput ? <Item
                testID="settings.personalHomeRuntime.restoreRecoveryBackupReveal"
                title={copy('backupRevealAction', 'Reveal backup')}
                onPress={() => void runExternalOperation(() => operations.revealBackupOutput!(restoreRecoveryBackup.path))}
            /> : null}
        </ItemGroup>
        <ItemGroup title={copy('advancedTitle', 'Advanced')} footer={copy('advancedFooter', 'Runtime controls and diagnostics for this computer.')}>
            {control.status?.version ? <Item title={t('settings.localRelayRuntime.versionTitle')} subtitle={control.status.version} showChevron={false} mode="info" /> : null}
            <Item testID="settings.localRelayRuntime.installOrUpdate" title={t('settings.localRelayRuntime.installOrUpdateAction')} onPress={() => void control.installOrUpdate()} disabled={control.isBusy || control.isUnavailable} />
            <Item testID="settings.localRelayRuntime.start" title={t('settings.localRelayRuntime.startAction')} onPress={() => void control.startRelay()} disabled={!canStart} />
            <Item testID="settings.localRelayRuntime.stop" title={t('settings.localRelayRuntime.stopAction')} onPress={() => void control.stopRelay()} disabled={!canStop} />
            <Item testID="settings.personalHomeRuntime.restart" title={copy('restartAction', 'Restart Personal Home')} onPress={() => void control.restartRelay()} disabled={disabled} />
            {returnRelocationRecovery && operations?.relocation?.prepareRecovery ? <Item
                testID="settings.personalHomeRuntime.recoverRelocationReturn"
                title={copy('relocationReturnAction', 'Return to Original Home')}
                subtitle={copy('relocationReturnSubtitle', 'Keep the original Home as the active location.')}
                onPress={() => void runExternalOperation(() => recoverRelocation(returnRelocationRecovery))}
                disabled={disabled}
            /> : null}
            {operations?.openDataLocation ? <Item testID="settings.personalHomeRuntime.openDataLocation" title={copy('openDataLocationAction', 'Open Home data location')} onPress={() => void runExternalOperation(() => operations.openDataLocation!(control.inspection?.layoutPaths.dataDir ?? ''))} disabled={!control.inspection?.layoutPaths.dataDir} /> : null}
            {operations?.openLogs ? <Item testID="settings.personalHomeRuntime.openLogs" title={copy('openLogsAction', 'Open runtime logs')} onPress={() => void runExternalOperation(() => operations.openLogs!(control.inspection?.layoutPaths.logsDir ?? ''))} disabled={!control.inspection?.layoutPaths.logsDir} /> : null}
            {operations?.removeProfile ? <Item testID="settings.personalHomeRuntime.removeProfile" title={copy('removeProfileAction', 'Remove Home from Happier')} subtitle={copy('removeProfileSubtitle', 'Removes this profile; runtime data stays on this computer.')} onPress={() => void confirmExternalOperation(copy('removeProfileTitle', 'Remove Personal Home profile?'), copy('removeProfileBody', 'This removes the profile but keeps the runtime and data.'), tLoose('common.remove'), operations.removeProfile!)} destructive /> : null}
            {operations?.uninstallRuntime ? <Item testID="settings.personalHomeRuntime.uninstallRuntime" title={copy('uninstallRuntimeAction', 'Uninstall runtime, keep data')} subtitle={copy('uninstallRuntimeSubtitle', 'Removes the service and binaries; Home data is preserved.')} onPress={() => void runExternalOperation(operations.uninstallRuntime!)} /> : null}
        </ItemGroup>
        <ItemGroup title={copy('deleteHomeDataTitle', 'Delete Home Data')} footer={copy('removeSectionFooter', 'Uninstall keeps Home data. Permanent deletion is a separate confirmed action.')}>
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
