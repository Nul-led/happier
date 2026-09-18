import {
    type ActionSettingsActionId,
    type ActionSurfaces,
    type ActionsSettingsV1,
} from '@happier-dev/protocol';

import { getActionSettingsTargetPreferenceSelected, setActionTargetSelected } from './actionSettingsTargetSelection';
import {
    getActionTargetApprovalOverride,
    isActionSettingsApprovalAction,
    resolveActionSettingsApprovalSurface,
    setActionTargetApprovalRequired,
} from './actionSettingsTargetApproval';
import type { ActionSettingsTargetDefinition, ActionSettingsTargetId } from './actionSettingsTargetDefinitions';

export type ActionSettingsApprovalControlValue = 'off' | 'default' | 'ask_first' | 'allowed';
export type ActionSettingsBooleanControlValue = 'off' | 'on';
export type ActionSettingsTargetControlKind = 'approval' | 'switch' | 'unavailable';

export type ActionSettingsTargetControlState =
    | Readonly<{
        kind: 'approval';
        value: ActionSettingsApprovalControlValue;
        approvalSurface: keyof ActionSurfaces;
    }>
    | Readonly<{
        kind: 'switch';
        value: ActionSettingsBooleanControlValue;
    }>
    | Readonly<{
        kind: 'unavailable';
        value: 'off';
    }>;

type ResolveActionSettingsTargetControlStateParams = Readonly<{
    settings: ActionsSettingsV1;
    actionId: ActionSettingsActionId;
    targetId: ActionSettingsTargetId;
    target?: ActionSettingsTargetDefinition;
    available?: boolean;
}>;

type ApplyActionSettingsTargetControlStateParams = Readonly<{
    settings: ActionsSettingsV1;
    actionId: ActionSettingsActionId;
    targetId: ActionSettingsTargetId;
    target?: ActionSettingsTargetDefinition;
    value: ActionSettingsApprovalControlValue | ActionSettingsBooleanControlValue;
}>;

function resolveApprovalControlSurface(params: Readonly<{
    actionId: ActionSettingsActionId;
    targetId: ActionSettingsTargetId;
    target?: ActionSettingsTargetDefinition;
    available: boolean;
}>): keyof ActionSurfaces | null {
    if (!params.available || isActionSettingsApprovalAction(params.actionId)) {
        return null;
    }
    return resolveActionSettingsApprovalSurface(params.actionId, params.targetId, params.target);
}

export function resolveActionSettingsTargetControlState(
    params: ResolveActionSettingsTargetControlStateParams,
): ActionSettingsTargetControlState {
    const available = params.available !== false;
    if (!available) {
        return { kind: 'unavailable', value: 'off' };
    }

    const selected = getActionSettingsTargetPreferenceSelected({
        settings: params.settings,
        actionId: params.actionId,
        targetId: params.targetId,
        ...(params.target ? { target: params.target } : {}),
    });
    const approvalSurface = resolveApprovalControlSurface({
        actionId: params.actionId,
        targetId: params.targetId,
        target: params.target,
        available,
    });

    if (!approvalSurface) {
        return {
            kind: 'switch',
            value: selected ? 'on' : 'off',
        };
    }

    if (!selected) {
        return {
            kind: 'approval',
            value: 'off',
            approvalSurface,
        };
    }

    const approvalOverride = getActionTargetApprovalOverride({
        settings: params.settings,
        actionId: params.actionId,
        targetId: params.targetId,
        ...(params.target ? { target: params.target } : {}),
    });

    return {
        kind: 'approval',
        value: approvalOverride === null ? 'default' : approvalOverride ? 'ask_first' : 'allowed',
        approvalSurface,
    };
}

export function applyActionSettingsTargetControlState(params: ApplyActionSettingsTargetControlStateParams): ActionsSettingsV1 {
    if (params.value === 'off') {
        const next = setActionTargetSelected({
            settings: params.settings,
            actionId: params.actionId,
            targetId: params.targetId,
            ...(params.target ? { target: params.target } : {}),
            selected: false,
        });
        return setActionTargetApprovalRequired({
            settings: next,
            actionId: params.actionId,
            targetId: params.targetId,
            ...(params.target ? { target: params.target } : {}),
            approvalRequired: null,
        });
    }

    if (params.value === 'ask_first') {
        const selected = setActionTargetSelected({
            settings: params.settings,
            actionId: params.actionId,
            targetId: params.targetId,
            ...(params.target ? { target: params.target } : {}),
            selected: true,
        });
        if (isActionSettingsApprovalAction(params.actionId) || !resolveActionSettingsApprovalSurface(
            params.actionId,
            params.targetId,
            params.target,
        )) {
            return selected;
        }
        return setActionTargetApprovalRequired({
            settings: selected,
            actionId: params.actionId,
            targetId: params.targetId,
            ...(params.target ? { target: params.target } : {}),
            approvalRequired: true,
        });
    }

    if (params.value === 'default') {
        const selected = setActionTargetSelected({
            settings: params.settings,
            actionId: params.actionId,
            targetId: params.targetId,
            ...(params.target ? { target: params.target } : {}),
            selected: true,
        });
        return setActionTargetApprovalRequired({
            settings: selected,
            actionId: params.actionId,
            targetId: params.targetId,
            ...(params.target ? { target: params.target } : {}),
            approvalRequired: null,
        });
    }

    if (params.value === 'allowed') {
        const selected = setActionTargetSelected({
            settings: params.settings,
            actionId: params.actionId,
            targetId: params.targetId,
            ...(params.target ? { target: params.target } : {}),
            selected: true,
        });
        return setActionTargetApprovalRequired({
            settings: selected,
            actionId: params.actionId,
            targetId: params.targetId,
            ...(params.target ? { target: params.target } : {}),
            approvalRequired: false,
        });
    }

    return setActionTargetSelected({
        settings: params.settings,
        actionId: params.actionId,
        targetId: params.targetId,
        ...(params.target ? { target: params.target } : {}),
        selected: true,
    });
}
