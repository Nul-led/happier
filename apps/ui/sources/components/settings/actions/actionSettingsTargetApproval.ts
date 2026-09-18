import { isApprovalRequiredByActionsSettings, setActionApprovalOverride, type ActionSettingsActionId, type ActionsSettingsV1 } from '@happier-dev/protocol';

import { normalizeActionsSettings } from './normalizeActionsSettings';
import {
    resolveActionSettingsTargetDefinition,
    type ActionSettingsSurface,
    type ActionSettingsTargetDefinition,
    type ActionSettingsTargetId,
} from './actionSettingsTargetDefinitions';

export function isActionSettingsApprovalAction(actionId: ActionSettingsActionId): boolean {
    return actionId === 'approval.request.create' || actionId === 'approval.request.decide';
}

export function resolveActionSettingsApprovalSurface(
    actionId: ActionSettingsActionId,
    targetId: ActionSettingsTargetId,
    target?: ActionSettingsTargetDefinition,
): ActionSettingsSurface | null {
    const resolvedTarget = resolveActionSettingsTargetDefinition({ actionId, targetId, target });
    if (resolvedTarget.kind === 'surface') {
        return resolvedTarget.surface;
    }

    if (resolvedTarget.kind === 'placement' && resolvedTarget.placement === 'slash_command') {
        return 'ui';
    }

    return null;
}

export function getActionTargetApprovalRequired(params: Readonly<{
    settings: ActionsSettingsV1;
    actionId: ActionSettingsActionId;
    targetId: ActionSettingsTargetId;
    target?: ActionSettingsTargetDefinition;
}>): boolean {
    const normalizedSettings = normalizeActionsSettings(params.settings);
    const surface = resolveActionSettingsApprovalSurface(params.actionId, params.targetId, params.target);
    if (!surface) {
        return false;
    }

    return isApprovalRequiredByActionsSettings(params.actionId, normalizedSettings, { surface });
}

/**
 * Reads the persisted setting, rather than its effective policy result. The
 * settings UI needs this distinction so a person can restore the canonical
 * default after explicitly requiring or waiving approval.
 */
export function getActionTargetApprovalOverride(params: Readonly<{
    settings: ActionsSettingsV1;
    actionId: ActionSettingsActionId;
    targetId: ActionSettingsTargetId;
    target?: ActionSettingsTargetDefinition;
}>): boolean | null {
    const normalizedSettings = normalizeActionsSettings(params.settings);
    const surface = resolveActionSettingsApprovalSurface(params.actionId, params.targetId, params.target);
    if (!surface) return null;
    if (normalizedSettings.actions[params.actionId]?.approvalRequiredSurfaces.includes(surface)) return true;
    if (normalizedSettings.approvalWaivedSurfaces?.[params.actionId]?.includes(surface)) return false;
    return null;
}

export function setActionTargetApprovalRequired(params: Readonly<{
    settings: ActionsSettingsV1;
    actionId: ActionSettingsActionId;
    targetId: ActionSettingsTargetId;
    target?: ActionSettingsTargetDefinition;
    approvalRequired: boolean | null;
}>): ActionsSettingsV1 {
    const normalizedSettings = normalizeActionsSettings(params.settings);
    const surface = resolveActionSettingsApprovalSurface(params.actionId, params.targetId, params.target);
    if (!surface) {
        return normalizedSettings;
    }

    return setActionApprovalOverride({
        settings: normalizedSettings,
        actionId: params.actionId,
        surface,
        approvalRequired: params.approvalRequired,
    });
}
