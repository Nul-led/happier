import type { AgentInputFolderChipState } from './definitions/AgentInputFolderChip';
import * as React from 'react';
import type { ActionListItem } from '@/components/ui/lists/ActionListSection';
import { resolveAgentInputControlLines } from './controls/resolveAgentInputControlLines';
import type { AgentInputControlId } from './controls/agentInputControlTypes';
import { buildCoreCollapsedControlActions } from './controls/buildCoreCollapsedControlActions';
import type { IconName } from '@/components/ui/icons/Icon';

export function buildAgentInputActionMenuActions(opts: {
    actionBarIsCollapsed: boolean;
    hasAnyActions: boolean;
    tint: string;
    agentId: string;
    agentIdentityIcon?: React.ReactNode;
    profileLabel: string | null;
    profileIcon: IconName;
    envVarsCount?: number;
    agentLabel?: string | null;
    engineLabel?: string | null;
    machineName?: string | null;
    currentPath?: string | null;
    folderChipState?: AgentInputFolderChipState;
    onRemoveFolder?: () => void;
    resumeSessionId?: string | null;
    sessionId?: string;
    onProfileClick?: () => void;
    onEnvVarsClick?: () => void;
    onAgentClick?: () => void;
    sessionModeLabel?: string | null;
    onSessionModeClick?: () => void;
    onMachineClick?: () => void;
    onPathClick?: () => void;
    onResumeClick?: () => void;
    onFileViewerPress?: () => void;
    canStop?: boolean;
    onStop?: () => void;
    extraControlActions?: Partial<Record<AgentInputControlId, ActionListItem | ReadonlyArray<ActionListItem>>>;
    /** Controls the host keeps on its collapsed bar; the menu leaves them out. */
    barControlIds?: readonly AgentInputControlId[];
    dismiss: () => void;
    blurInput: () => void;
}): ActionListItem[] {
    if (!opts.actionBarIsCollapsed || !opts.hasAnyActions) return [] as ActionListItem[];

    const controlActionsById: Partial<Record<AgentInputControlId, ReadonlyArray<ActionListItem>>> = {
        ...buildCoreCollapsedControlActions(opts),
    };
    for (const [controlId, actionOrActions] of Object.entries(opts.extraControlActions ?? {}) as Array<[AgentInputControlId, ActionListItem | ReadonlyArray<ActionListItem>]>) {
        controlActionsById[controlId] = Array.isArray(actionOrActions) ? actionOrActions : [actionOrActions];
    }

    const onBar = new Set(opts.barControlIds ?? []);
    const orderedControlIds = resolveAgentInputControlLines({
        layout: 'collapsed',
        controlIds: (Object.keys(controlActionsById) as AgentInputControlId[]).filter((controlId) => !onBar.has(controlId)),
    }).collapsed;

    return [
        ...orderedControlIds.flatMap((controlId) => {
            return controlActionsById[controlId] ?? [];
        }),
    ];
}
