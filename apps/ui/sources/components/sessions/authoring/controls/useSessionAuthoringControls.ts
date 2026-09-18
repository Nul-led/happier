import * as React from 'react';

import type { AcpConfigOptionOverridesV1 } from '@happier-dev/protocol';

import type { AgentInputChipPickerOption } from '@/components/sessions/agentInput/components/AgentInputChipPickerTypes';
import {
    DEFAULT_OPTION_CHIP_CYCLE_MAX_OPTIONS,
    resolveChipOptionInteraction,
    shouldRenderChipForOptions,
    type ChipOptionInteraction,
} from '@/components/sessions/agentInput/chipOptionInteraction';
import {
    resolveSessionModeChipPresentation,
    type SessionModeChipPresentation,
} from '@/components/sessions/agentInput/controls/resolveSessionModeChipPresentation';
import {
    reportedModelSummary,
    resolveReportedModelStatus,
    type ReportedModelStatus,
} from '@/components/sessions/modelPicker/reportedModelPresentation';
import type { OptionPickerProbeState } from '@/components/sessions/pickers/OptionPickerOverlay';
import { describeEffectiveModelMode } from '@/sync/domains/models/describeEffectiveModelMode';
import { buildExtendedContextModelControl } from '@/sync/domains/models/extendedContextModelControl';
import {
    findModelOptionForEffectiveModelId,
    getModelOptionsForSession,
    supportsFreeformModelSelectionForSession,
    type ModelOption,
} from '@/sync/domains/models/modelOptions';
import { describeEffectivePermissionMode } from '@/sync/domains/permissions/describeEffectivePermissionMode';
import {
    getPermissionModeBadgeLabelForAgentType,
    getPermissionModeLabelForAgentType,
    getPermissionModeOptionsForSession,
} from '@/sync/domains/permissions/permissionModeOptions';
import type { ModelMode, PermissionMode } from '@/sync/domains/permissions/permissionTypes';
import {
    computeAcpConfigOptionControls,
    computeAcpConfigOptionControlsFromOverride,
    type AcpConfigOptionControl,
    type SessionConfigOptionInput,
} from '@/sync/domains/sessionControl/configOptionsControl';
import { readSessionModelsState } from '@/sync/domains/sessionControl/readSessionControlMetadata';
import { computeSessionModePickerControl } from '@/sync/domains/sessionControl/sessionModeControl';
import { useSetting } from '@/sync/domains/state/storage';
import type { Metadata } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';

/**
 * The one owner of effective Session-authoring policy.
 *
 * Model options, the effective permission and model descriptions, the ACP
 * session-mode composition and the configuration-option controls are the same
 * facts whether the values are being authored in the live composer or in a
 * workflow step. They were previously computed inline inside `AgentInput`, so a
 * second authoring surface could only have re-derived them — a split brain over
 * "what is actually selected". Both callers now read them here.
 *
 * This hook resolves facts only. Applying a selection stays with the caller that
 * owns the value, so nothing here can navigate, persist a remembered selection,
 * or write a preference merely because a value changed.
 */

type SessionModeOptionOverride = Readonly<{ id: string; name: string; description?: string }>;

export type SessionAuthoringSessionModeChipControl = Readonly<{
    options: ReadonlyArray<SessionModeOptionOverride>;
    selectedId: string;
    label: string;
    isPending: boolean;
}>;

export type SessionAuthoringAppliedModelPresentation = Readonly<{
    optionValue: string;
    status: ReportedModelStatus;
    summary: string;
}>;

export type SessionAuthoringControlsInput = Readonly<{
    /** The Agent identity whose static policy answers these questions. */
    agentId: string;
    metadata?: Metadata | null;
    /** Changing session identity clears the sticky model-option memory. */
    sessionId?: string;
    sessionActive?: boolean;
    permissionMode?: PermissionMode | null;
    modelMode?: ModelMode | null;
    modelOptionsOverride?: readonly ModelOption[] | null;
    /** Capability facts, not handlers: the caller keeps its own mutation owner. */
    canChangeModel: boolean;
    canChangeSessionMode: boolean;
    canChangeConfigOption: boolean;
    acpSessionModeOptionsOverride?: ReadonlyArray<SessionModeOptionOverride> | null;
    acpSessionModeSelectedIdOverride?: string | null;
    acpConfigOptionsOverride?: ReadonlyArray<SessionConfigOptionInput> | null;
    acpConfigOptionOverridesOverride?: AcpConfigOptionOverridesV1 | null;
}>;

export type SessionAuthoringControls = Readonly<{
    modelOptions: readonly ModelOption[];
    sessionModelOptionsProbe: OptionPickerProbeState | null;
    permissionModeOptions: ReturnType<typeof getPermissionModeOptionsForSession>;
    permissionModeOrder: readonly PermissionMode[];
    effectivePermissionPolicy: ReturnType<typeof describeEffectivePermissionMode>;
    effectivePermissionLabel: string;
    permissionChipLabel: string;
    effectiveModelPolicy: ReturnType<typeof describeEffectiveModelMode>;
    selectedModelLabel: string;
    appliedModelPresentation: SessionAuthoringAppliedModelPresentation | null;
    modelApplyTiming: string;
    modelNotes: readonly string[];
    canEnterCustomModel: boolean;
    shouldShowModelOptionDescriptions: boolean;
    selectedModelForControls: ModelOption | null;
    selectedModelOptionControls: readonly AcpConfigOptionControl[] | null;
    acpConfigOptionControls: readonly AcpConfigOptionControl[] | null;
    sessionModeChipControl: SessionAuthoringSessionModeChipControl | null;
    sessionModePickerOptions: ReadonlyArray<AgentInputChipPickerOption>;
    shouldRenderSessionModeChip: boolean;
    sessionModeChipPresentation: SessionModeChipPresentation | null;
    sessionModeChipInteraction: ChipOptionInteraction<string> | null;
}>;

export function useSessionAuthoringControls(
    input: SessionAuthoringControlsInput,
): SessionAuthoringControls {
    const {
        agentId,
        canChangeConfigOption,
        canChangeModel,
        canChangeSessionMode,
        sessionId,
    } = input;
    const metadata = input.metadata ?? null;
    const modelOptionsOverride = input.modelOptionsOverride ?? null;
    const acpConfigOptionsOverride = input.acpConfigOptionsOverride ?? null;
    const acpConfigOptionOverridesOverride = input.acpConfigOptionOverridesOverride ?? null;

    const sessionPermissionModeApplyTiming = useSetting('sessionPermissionModeApplyTiming');

    // The last non-empty model list for THIS session, so a runner that briefly
    // reports zero models does not blank the picker mid-session.
    const lastNonEmptySessionModelOptionsRef = React.useRef<readonly ModelOption[] | null>(null);
    React.useEffect(() => {
        lastNonEmptySessionModelOptionsRef.current = null;
    }, [sessionId, agentId]);

    const sessionModelsState = React.useMemo(() => {
        if (modelOptionsOverride) return { hasSessionModelsState: false, availableCount: 0 };
        const raw = readSessionModelsState(metadata);
        const stateAgentId = typeof raw?.agentId === 'string' ? raw.agentId.trim() : '';
        if (!stateAgentId || stateAgentId !== agentId) {
            return { hasSessionModelsState: false, availableCount: 0 };
        }
        const available = Array.isArray(raw?.availableModels) ? raw.availableModels : [];
        return { hasSessionModelsState: true, availableCount: available.length };
    }, [agentId, metadata, modelOptionsOverride]);

    const baseModelOptions = React.useMemo(() => {
        if (modelOptionsOverride) return modelOptionsOverride;
        return getModelOptionsForSession(agentId, metadata);
    }, [agentId, metadata, modelOptionsOverride]);

    const modelOptions = React.useMemo(() => {
        if (modelOptionsOverride) return baseModelOptions;
        if (sessionModelsState.hasSessionModelsState && sessionModelsState.availableCount === 0) {
            const sticky = lastNonEmptySessionModelOptionsRef.current;
            if (sticky && sticky.length > 0) return sticky;
        }
        return baseModelOptions;
    }, [
        baseModelOptions,
        modelOptionsOverride,
        sessionModelsState.availableCount,
        sessionModelsState.hasSessionModelsState,
    ]);

    const sessionModelOptionsProbe = React.useMemo<OptionPickerProbeState | null>(() => {
        if (modelOptionsOverride) return null;
        if (!sessionModelsState.hasSessionModelsState) return null;
        if (sessionModelsState.availableCount > 0) return null;
        const phase: OptionPickerProbeState['phase'] = lastNonEmptySessionModelOptionsRef.current
            ? 'refreshing'
            : 'loading';
        return { phase };
    }, [modelOptionsOverride, sessionModelsState.availableCount, sessionModelsState.hasSessionModelsState]);

    React.useEffect(() => {
        if (modelOptionsOverride) return;
        if (!sessionModelsState.hasSessionModelsState) {
            lastNonEmptySessionModelOptionsRef.current = null;
            return;
        }
        if (sessionModelsState.availableCount > 0 && modelOptions.length > 0) {
            lastNonEmptySessionModelOptionsRef.current = modelOptions;
        }
    }, [
        modelOptions,
        modelOptionsOverride,
        sessionModelsState.availableCount,
        sessionModelsState.hasSessionModelsState,
    ]);

    const permissionModeOptions = React.useMemo(() => {
        return getPermissionModeOptionsForSession(agentId, metadata);
    }, [agentId, metadata]);

    const permissionModeOrder = React.useMemo(() => {
        return permissionModeOptions.map((option) => option.value);
    }, [permissionModeOptions]);

    const effectivePermissionPolicy = React.useMemo(() => {
        return describeEffectivePermissionMode({
            agentType: agentId,
            selectedMode: input.permissionMode ?? 'default',
            metadata,
            applyTiming: sessionPermissionModeApplyTiming ?? 'immediate',
        });
    }, [agentId, input.permissionMode, metadata, sessionPermissionModeApplyTiming]);

    const effectivePermissionLabel = React.useMemo(() => {
        return getPermissionModeLabelForAgentType(agentId, effectivePermissionPolicy.effectiveMode);
    }, [agentId, effectivePermissionPolicy.effectiveMode]);

    const permissionChipLabel = React.useMemo(() => {
        return getPermissionModeBadgeLabelForAgentType(agentId, effectivePermissionPolicy.effectiveMode);
    }, [agentId, effectivePermissionPolicy.effectiveMode]);

    const effectiveModelPolicy = React.useMemo(() => {
        return describeEffectiveModelMode({
            agentType: agentId,
            selectedModelId: input.modelMode ?? 'default',
            metadata,
        });
    }, [agentId, input.modelMode, metadata]);

    const selectedModelLabel = React.useMemo(() => {
        const found = findModelOptionForEffectiveModelId(modelOptions, effectiveModelPolicy.selectedModelId);
        if (found) return found.label;
        return effectiveModelPolicy.selectedModelId === 'default'
            ? t('agentInput.model.useCliSettings')
            : effectiveModelPolicy.selectedModelId;
    }, [effectiveModelPolicy.selectedModelId, modelOptions]);

    const appliedModelPresentation = React.useMemo<SessionAuthoringAppliedModelPresentation | null>(() => {
        const appliedModelId = effectiveModelPolicy.appliedModelId;
        if (!appliedModelId) return null;
        const found = findModelOptionForEffectiveModelId(modelOptions, appliedModelId);
        const label = found?.label ?? appliedModelId;
        const status: ReportedModelStatus = resolveReportedModelStatus(input.sessionActive);
        return {
            optionValue: found?.value ?? appliedModelId,
            status,
            summary: reportedModelSummary(status, label),
        };
    }, [effectiveModelPolicy.appliedModelId, input.sessionActive, modelOptions]);

    // One line under the section label: what is running, and when a change to it
    // takes effect. Anything a provider adds beyond that stays a note, so the
    // ordinary case is a label, a line and the models — never a paragraph.
    const modelApplyTiming = React.useMemo(() => (
        effectiveModelPolicy.applyScope === 'spawn_only'
            ? t('agentInput.model.applyTimingNewSession')
            : t('agentInput.model.applyTimingNextMessage')
    ), [effectiveModelPolicy.applyScope]);

    const modelNotes = React.useMemo(() => {
        if (input.sessionActive === false) {
            return [t('agentInput.model.selectedForResume')];
        }
        return effectiveModelPolicy.notes;
    }, [effectiveModelPolicy.notes, input.sessionActive]);

    const canEnterCustomModel = React.useMemo(() => {
        return supportsFreeformModelSelectionForSession(agentId, metadata);
    }, [agentId, metadata]);

    const shouldShowModelOptionDescriptions = React.useMemo(() => {
        return modelOptions.some((option) => {
            if (option.value === 'default') return false;
            return typeof option.description === 'string' && option.description.trim().length > 0;
        });
    }, [modelOptions]);

    const preflightAcpSessionModeOptions = React.useMemo(() => {
        const raw = input.acpSessionModeOptionsOverride;
        if (!Array.isArray(raw) || raw.length === 0) return null;
        const cleaned = raw
            .filter((mode) => mode && typeof mode.id === 'string' && typeof mode.name === 'string')
            .map((mode) => ({
                id: String(mode.id),
                name: String(mode.name),
                ...(typeof mode.description === 'string' ? { description: mode.description } : {}),
            }))
            .filter((mode) => mode.id.trim().length > 0 && mode.name.trim().length > 0);
        return cleaned.length > 0 ? cleaned : null;
    }, [input.acpSessionModeOptionsOverride]);

    const sessionModePickerControl = React.useMemo(() => {
        if (!canChangeSessionMode) return null;
        // When preflight options are provided (e.g. New Session), prefer the override surface so
        // selections can be reflected immediately without relying on session metadata updates.
        if (preflightAcpSessionModeOptions) return null;
        return computeSessionModePickerControl({ agentId, metadata });
    }, [agentId, canChangeSessionMode, metadata, preflightAcpSessionModeOptions]);

    const preflightAcpSessionModeEffective = React.useMemo(() => {
        const selected = typeof input.acpSessionModeSelectedIdOverride === 'string'
            ? input.acpSessionModeSelectedIdOverride.trim()
            : '';
        const effectiveId = selected || 'default';
        const option = preflightAcpSessionModeOptions?.find((candidate) => candidate.id === effectiveId) ?? null;
        return {
            id: effectiveId,
            name: option?.name ?? (effectiveId === 'default' ? t('common.default') : effectiveId),
        };
    }, [input.acpSessionModeSelectedIdOverride, preflightAcpSessionModeOptions]);

    const sessionModeChipControl = React.useMemo<SessionAuthoringSessionModeChipControl | null>(() => {
        if (!canChangeSessionMode) return null;
        if (sessionModePickerControl) {
            return {
                options: sessionModePickerControl.options,
                selectedId: (
                    sessionModePickerControl.requestedModeId
                    ?? sessionModePickerControl.effectiveModeId
                    ?? 'default'
                ),
                label: sessionModePickerControl.effectiveModeName,
                isPending: sessionModePickerControl.isPending,
            };
        }
        if (preflightAcpSessionModeOptions) {
            return {
                options: preflightAcpSessionModeOptions,
                selectedId: preflightAcpSessionModeEffective.id,
                label: preflightAcpSessionModeEffective.name,
                isPending: false,
            };
        }
        return null;
    }, [
        canChangeSessionMode,
        preflightAcpSessionModeEffective.id,
        preflightAcpSessionModeEffective.name,
        preflightAcpSessionModeOptions,
        sessionModePickerControl,
    ]);

    const sessionModePickerOptions = React.useMemo<ReadonlyArray<AgentInputChipPickerOption>>(() => {
        if (!sessionModeChipControl) return [];
        const optionsById = new Map(sessionModeChipControl.options.map((option) => [option.id, option]));
        const uniqueIds = Array.from(
            new Set([
                'default',
                ...sessionModeChipControl.options.map((option) => option.id).filter((id) => id && id !== 'default'),
            ]),
        );
        return uniqueIds.map((id) => ({
            id,
            label: optionsById.get(id)?.name ?? (id === 'default' ? t('common.default') : id),
            subtitle: optionsById.get(id)?.description,
        }));
    }, [sessionModeChipControl]);

    const shouldRenderSessionModeChip = React.useMemo(() => {
        return shouldRenderChipForOptions({
            optionCount: sessionModePickerOptions.length,
            showWhenNoOptions: false,
            showWhenSingleOption: false,
        });
    }, [sessionModePickerOptions.length]);

    const sessionModeChipPresentation = React.useMemo(() => {
        return sessionModeChipControl ? resolveSessionModeChipPresentation(sessionModeChipControl) : null;
    }, [sessionModeChipControl]);

    const sessionModeChipInteraction = React.useMemo(() => {
        if (!sessionModeChipControl) return null;
        const selectableOptionIds = Array.from(new Set(
            sessionModeChipControl.options
                .map((option) => option.id?.trim?.() ?? option.id)
                .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ));
        return resolveChipOptionInteraction({
            currentOptionId: sessionModeChipControl.selectedId,
            selectableOptionIds,
            cycleMaxOptions: DEFAULT_OPTION_CHIP_CYCLE_MAX_OPTIONS,
        });
    }, [sessionModeChipControl]);

    const acpConfigOptionControls = React.useMemo(() => {
        if (!canChangeConfigOption) return null;
        if (acpConfigOptionsOverride) {
            return computeAcpConfigOptionControlsFromOverride({
                agentId,
                configOptions: acpConfigOptionsOverride,
                overrides: acpConfigOptionOverridesOverride?.overrides ?? null,
            });
        }
        return computeAcpConfigOptionControls({ agentId, metadata });
    }, [
        acpConfigOptionOverridesOverride,
        acpConfigOptionsOverride,
        agentId,
        canChangeConfigOption,
        metadata,
    ]);

    const selectedModelForControls = React.useMemo(() => (
        findModelOptionForEffectiveModelId(modelOptions, effectiveModelPolicy.selectedModelId)
    ), [effectiveModelPolicy.selectedModelId, modelOptions]);

    const selectedModelOptionControls = React.useMemo(() => {
        const baseControls = canChangeConfigOption && selectedModelForControls?.modelOptions?.length
            ? [...(computeAcpConfigOptionControlsFromOverride({
                agentId,
                configOptions: selectedModelForControls.modelOptions,
                overrides: acpConfigOptionOverridesOverride?.overrides ?? null,
            }) ?? [])]
            : [];
        const extendedContextControl = canChangeModel
            ? buildExtendedContextModelControl({
                model: selectedModelForControls,
                effectiveModelId: effectiveModelPolicy.selectedModelId,
            })
            : null;
        if (extendedContextControl) baseControls.push(extendedContextControl);
        return baseControls.length > 0 ? baseControls : null;
    }, [
        acpConfigOptionOverridesOverride,
        agentId,
        canChangeConfigOption,
        canChangeModel,
        effectiveModelPolicy.selectedModelId,
        selectedModelForControls,
    ]);

    return {
        modelOptions,
        sessionModelOptionsProbe,
        permissionModeOptions,
        permissionModeOrder,
        effectivePermissionPolicy,
        effectivePermissionLabel,
        permissionChipLabel,
        effectiveModelPolicy,
        selectedModelLabel,
        appliedModelPresentation,
        modelApplyTiming,
        modelNotes,
        canEnterCustomModel,
        shouldShowModelOptionDescriptions,
        selectedModelForControls,
        selectedModelOptionControls,
        acpConfigOptionControls,
        sessionModeChipControl,
        sessionModePickerOptions,
        shouldRenderSessionModeChip,
        sessionModeChipPresentation,
        sessionModeChipInteraction,
    };
}
