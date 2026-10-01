import * as React from 'react';

import type { PluginMachineExecutionOriginV1 } from '@happier-dev/protocol';

import type {
    ServerScopedMachineGroup,
    ServerScopedMachinePresentation,
} from '@/components/sessions/new/hooks/machines/useServerScopedMachineOptions';
import { ServerScopedMachineSelector } from '@/components/sessions/new/components/ServerScopedMachineSelector';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { t } from '@/text';
import { resolveMachineAdministrationTargetLabel, type MachineAdministrationCandidateV1 } from '@/sync/domains/machines/administration/targetSelection';
import {
    composePluginMachineExecutionOriginV1,
    isPluginMachineExecutionOriginCandidateSelectable,
    type PluginMachineExecutionOriginCandidateV1,
    type PluginMachineOriginRejectionReasonV1,
} from '@/sync/domains/machines/administration/pluginExecutionOrigin';
import {
    type PluginExecutionOriginSelectionMutationResult,
    type PluginMachineExecutionOriginSelectionV1,
} from '@/sync/domains/machines/administration/usePluginExecutionOriginSelection';

type PresentedPluginOrigin = ServerScopedMachinePresentation & Readonly<{
    candidate: PluginMachineExecutionOriginCandidateV1;
    origin: PluginMachineExecutionOriginV1;
}>;

function exactOriginKey(origin: PluginMachineExecutionOriginV1): string {
    return [
        origin.serverIdentityId,
        origin.materializationRef.machineId,
        origin.materializationRef.materializationId,
        origin.materializationRef.pluginId,
    ].map((part) => `${part.length}:${part}`).join('|');
}

function exactOriginsEqual(
    left: PluginMachineExecutionOriginV1 | null,
    right: PluginMachineExecutionOriginV1,
): boolean {
    return left !== null && exactOriginKey(left) === exactOriginKey(right);
}

function resolveCandidatePresentationDetail(candidate: PluginMachineExecutionOriginCandidateV1): string {
    const version = `${t('common.version')} ${candidate.materialization.version}`;
    if (candidate.releaseContent === 'conflict') {
        return `${t('settingsPlugins.executionOriginReleaseContentConflict')} · ${version}`;
    }
    return isPluginMachineExecutionOriginCandidateSelectable(candidate)
        ? version
        : `${originReasonDetail(candidate.validation.kind === 'rejected' ? candidate.validation.reason : 'unknown')} · ${version}`;
}

function originReasonDetail(reason: PluginMachineOriginRejectionReasonV1 | 'no_materialization' | 'included_with_happier' | 'different_versions'): string {
    switch (reason) {
        case 'content_conflict': return t('settingsPlugins.executionOriginReleaseContentConflict');
        case 'disabled': return t('settingsPlugins.machineMatrix.state.disabled');
        case 'untrusted': return t('settingsPlugins.machineMatrix.state.untrusted');
        case 'incompatible': return t('settingsPlugins.machineMatrix.state.incompatible');
        case 'machine_local': return t('settingsPlugins.machineMatrix.state.localOnly');
        case 'offline': return t('settingsProviders.detail.machineOffline');
        case 'stale': return t('settingsPlugins.machineMatrix.state.staleOffline');
        case 'missing': return t('settingsPlugins.targetSelection.missing');
        case 'replaced': return t('settingsPlugins.targetSelection.replaced');
        case 'revoked': return t('settingsPlugins.targetSelection.revoked');
        case 'plugin_mismatch': return t('settingsPlugins.targetSelection.pluginMismatch');
        case 'no_materialization': return t('settingsPlugins.targetSelection.noMaterialization');
        case 'included_with_happier': return t('settingsPlugins.surfaces.runsEverywhere');
        case 'different_versions': return t('settingsPlugins.targetSelection.differentVersions');
        case 'unknown': return t('settingsPlugins.targetSelection.unknown');
    }
}

function buildOriginGroups(
    candidates: readonly PluginMachineExecutionOriginCandidateV1[],
    machineCandidates: readonly MachineAdministrationCandidateV1[],
): readonly ServerScopedMachineGroup<PresentedPluginOrigin>[] {
    const groups = new Map<string, PresentedPluginOrigin[]>();
    for (const candidate of candidates) {
        const materialization = candidate.materialization;
        const origin = composePluginMachineExecutionOriginV1(materialization);
        const labels = resolveMachineAdministrationTargetLabel({ target: materialization, candidates: machineCandidates })!;
        const rows = groups.get(materialization.serverIdentityId) ?? [];
        rows.push(Object.freeze({
            id: materialization.machineId,
            serverId: materialization.serverIdentityId,
            serverName: labels.server,
            updatedAt: materialization.observedAt,
            active: isPluginMachineExecutionOriginCandidateSelectable(candidate),
            activeAt: materialization.observedAt,
            metadataVersion: 1,
            metadata: Object.freeze({
                displayName: labels.machine,
                host: materialization.machineId,
            }),
            candidate,
            origin,
        }));
        groups.set(materialization.serverIdentityId, rows);
    }
    return Object.freeze([...groups.entries()].map(([serverIdentityId, machines]) => Object.freeze({
        serverId: serverIdentityId,
        serverName: machines[0]!.serverName,
        machines,
        loading: false,
        signedOut: false,
    })));
}

export type PluginMachineExecutionOriginPresentation = Readonly<{
    title: string;
    subtitle?: string;
    detail: string;
    selected: boolean;
}>;

/** The one user-facing presentation for the exact persisted plugin origin. */
export function resolvePluginMachineExecutionOriginPresentation(
    selection: PluginMachineExecutionOriginSelectionV1,
    machineCandidates: readonly MachineAdministrationCandidateV1[] = [],
): PluginMachineExecutionOriginPresentation {
    const selectedOrigin = selection.selectedOrigin
        ?? (selection.state.kind === 'selected' ? selection.state.origin : null);
    if (selectedOrigin) {
        const labels = resolveMachineAdministrationTargetLabel({ target: { serverIdentityId: selectedOrigin.serverIdentityId, machineId: selectedOrigin.materializationRef.machineId }, candidates: machineCandidates })!;
        const selectedCandidate = selection.candidates.find((candidate) => exactOriginsEqual(
            selectedOrigin,
            composePluginMachineExecutionOriginV1(candidate.materialization),
        ));
        return {
            title: labels.machine,
            subtitle: labels.machine === selectedOrigin.materializationRef.machineId
                ? labels.server
                : [labels.server, selectedOrigin.materializationRef.machineId].join(' · '),
            detail: selection.state.kind === 'unavailable'
                ? selection.state.reasons.map(originReasonDetail).join(' · ')
                : selectedCandidate
                ? resolveCandidatePresentationDetail(selectedCandidate)
                : t('common.unavailable'),
            selected: true,
        };
    }
    if (selection.state.kind === 'conflict') {
        return {
            title: t('common.warning'),
            detail: selection.state.reasons.map(originReasonDetail).join(' · '),
            selected: false,
        };
    }
    // Nothing chosen: say so, and whether there is anything to choose from (never the New Session copy).
    return {
        title: selection.state.kind === 'unavailable'
            ? selection.state.reasons.includes('included_with_happier')
                ? t('settingsPlugins.rowSource.bundled')
                : t('settingsPlugins.surfaces.runOnNoneAvailable')
            : t('settingsPlugins.surfaces.runOnNoneChosen'),
        detail: selection.state.kind === 'unavailable'
            ? selection.state.reasons.map(originReasonDetail).join(' · ')
            : t('settingsPlugins.targetSelection.selectionRequired'),
        selected: false,
    };
}

export function PluginMachineExecutionOriginSelectorView(props: Readonly<{
    selection: PluginMachineExecutionOriginSelectionV1;
    testIDPrefix?: string;
    /** Contextual label for the machine scope this selector presents. */
    groupTitle?: string;
    machineCandidates?: readonly MachineAdministrationCandidateV1[];
}>) {
    const [pickerOpen, setPickerOpen] = React.useState(false);
    const [settlementError, setSettlementError] = React.useState<string | null>(null);
    const settleSelection = React.useCallback(async (
        mutation: Promise<PluginExecutionOriginSelectionMutationResult>,
    ) => {
        try {
            const result = await mutation;
            if (result.status === 'applied') {
                setSettlementError(null);
                setPickerOpen(false);
                return;
            }
            setSettlementError(result.status === 'outcomeUnknown'
                ? t('settingsProviders.errors.mutationOutcomeUnknownDescription')
                : t('settingsPlugins.genericSettingsSaveError'));
        } catch {
            setSettlementError(t('settingsPlugins.genericSettingsSaveError'));
        }
    }, []);
    const current = resolvePluginMachineExecutionOriginPresentation(props.selection, props.machineCandidates);
    const groups = React.useMemo(
        () => buildOriginGroups(props.selection.candidates, props.machineCandidates ?? []),
        [props.selection.candidates, props.machineCandidates],
    );
    const selectedOrigin = props.selection.selectedOrigin
        ?? (props.selection.state.kind === 'selected' ? props.selection.state.origin : null);
    const currentTestID = props.testIDPrefix ? `${props.testIDPrefix}.current` : undefined;
    const clearTestID = props.testIDPrefix ? `${props.testIDPrefix}.clear` : undefined;
    const groupTitle = props.groupTitle ?? t('settingsProviders.detail.targetMachine');
    const clearAccessibilityScope = props.groupTitle ?? t('settingsPlugins.executionOriginTitle');

    return (
        <>
            <ItemGroup title={groupTitle}>
                <Item
                    testID={currentTestID}
                    title={current.title}
                    subtitle={[current.subtitle, current.detail].filter(Boolean).join('\n')}
                    subtitleLines={0}
                    detail={groups.length > 0 ? t('common.change') : undefined}
                    selected={current.selected}
                    mode={groups.length > 0 ? 'interactive' : 'info'}
                    showChevron={groups.length > 0}
                    accessibilityExpanded={groups.length > 0 ? pickerOpen : undefined}
                    accessibilityHint={groups.length > 0 ? t('common.change') : undefined}
                    onPress={groups.length > 0 ? () => setPickerOpen((open) => !open) : undefined}
                />
                {props.selection.selectedOrigin ? (
                    <Item
                        testID={clearTestID}
                        title={t('settingsPlugins.targetSelection.clear')}
                        accessibilityLabel={`${t('settingsPlugins.targetSelection.clear')}: ${clearAccessibilityScope}`}
                        onPress={() => { void settleSelection(props.selection.clearOrigin()); }}
                        showChevron={false}
                    />
                ) : null}
                {settlementError ? (
                    <Item
                        testID={props.testIDPrefix ? `${props.testIDPrefix}.settlementError` : undefined}
                        title={settlementError}
                        mode="info"
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>
            {pickerOpen && groups.length > 0 ? (
                <ServerScopedMachineSelector
                    groups={groups}
                    selectedMachineId={selectedOrigin?.materializationRef.machineId ?? null}
                    selectedServerId={selectedOrigin?.serverIdentityId ?? null}
                    onSelect={(machine) => { void settleSelection(props.selection.selectOrigin(machine.origin)); }}
                    resolveMachineAvailability={(machine) => ({
                        detail: resolveCandidatePresentationDetail(machine.candidate),
                        selectable: isPluginMachineExecutionOriginCandidateSelectable(machine.candidate),
                    })}
                    getMachineKey={(machine) => exactOriginKey(machine.origin)}
                    isMachineSelected={(machine) => exactOriginsEqual(selectedOrigin, machine.origin)}
                    testIdPrefix={props.testIDPrefix}
                />
            ) : null}
        </>
    );
}
