import * as React from 'react';

import { SelectionList, resolvePopoverSelectionListHeightBehavior } from '@/components/ui/selectionList';
import type { Machine } from '@/sync/domains/state/storageTypes';
import type { MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';

import type { ServerScopedMachineGroup } from '@/components/sessions/new/hooks/machines/useServerScopedMachineOptions';
import {
    useMachineSelectionListModel,
    type MachineSelectionAvailability,
    type MachineSelectionPresentation,
    type ScopedSelectionMachine,
    type ServerScopedMachinePoolGroup,
    type ServerScopedMachinePoolSelection,
    type TemporaryComputerSelection,
} from './machineSelection/useMachineSelectionListModel';
import type { MachinePoolSelectionStatus } from '@/components/sessions/new/hooks/machines/useMachinePoolSelection';

/**
 * The one machine list: the new-session composer popover and picker route, and the settings
 * machine-scope chip, all render this content. Callers that are not launching a session turn off the
 * launch-only concepts (favorites, recents, CLI glyphs, pools, Temporary computer) and may supply
 * their own availability decision.
 */
export type NewSessionMachineSelectionContentProps<TMachine extends MachineDisplayRenderable = Machine> = Readonly<{
    groups: ReadonlyArray<ServerScopedMachineGroup<ScopedSelectionMachine<TMachine>>>;
    poolGroups?: ReadonlyArray<ServerScopedMachinePoolGroup>;
    selectedMachine: TMachine | null;
    selectedServerId: string | null;
    recentMachines: ReadonlyArray<TMachine>;
    favoriteMachines: ReadonlyArray<TMachine>;
    onSelectMachine: (machine: TMachine) => void;
    onSelectScopedMachine: (machine: ScopedSelectionMachine<TMachine>) => void;
    resolveMachineAvailability?: (machine: TMachine, serverId: string) => MachineSelectionAvailability;
    resolveMachinePresentation?: (machine: TMachine) => MachineSelectionPresentation;
    onSelectPool?: (selection: ServerScopedMachinePoolSelection) => void;
    temporaryComputers?: readonly TemporaryComputerSelection[];
    poolSelectionStatus?: MachinePoolSelectionStatus;
    onRefreshMachines?: () => void;
    onRefreshPools?: (serverId: string) => void;
    onOpenPoolSettings?: (target: Readonly<{ serverId: string; poolId: string }>) => void;
    onDismissPoolSelection?: () => void;
    serverId?: string | null;
    onToggleFavorite?: (machine: TMachine) => void;
    showFavorites?: boolean;
    showRecent?: boolean;
    showSearch?: boolean;
    searchPlacement?: 'header' | 'favorites' | 'all';
    testIdPrefix?: string;
    /** Test id of the list itself. */
    testID?: string;
    showCliGlyphs?: boolean;
    autoDetectCliGlyphs?: boolean;
    maxHeight?: number;
}>;

export function NewSessionMachineSelectionContent<TMachine extends MachineDisplayRenderable = Machine>(
    props: NewSessionMachineSelectionContentProps<TMachine>,
) {
    const listModel = useMachineSelectionListModel<TMachine>({
        groups: props.groups,
        poolGroups: props.poolGroups,
        selectedMachine: props.selectedMachine,
        selectedServerId: props.selectedServerId,
        recentMachines: props.recentMachines,
        favoriteMachines: props.favoriteMachines,
        onSelectMachine: props.onSelectMachine,
        onSelectScopedMachine: props.onSelectScopedMachine,
        resolveMachineAvailability: props.resolveMachineAvailability,
        resolveMachinePresentation: props.resolveMachinePresentation,
        onSelectPool: props.onSelectPool,
        temporaryComputers: props.temporaryComputers,
        poolSelectionStatus: props.poolSelectionStatus,
        onRefreshMachines: props.onRefreshMachines,
        onRefreshPools: props.onRefreshPools,
        onOpenPoolSettings: props.onOpenPoolSettings,
        onDismissPoolSelection: props.onDismissPoolSelection,
        serverId: props.serverId,
        onToggleFavorite: props.onToggleFavorite,
        showFavorites: props.showFavorites ?? true,
        showRecent: props.showRecent ?? true,
        showSearch: props.showSearch ?? true,
        showCliGlyphs: props.showCliGlyphs ?? true,
        autoDetectCliGlyphs: props.autoDetectCliGlyphs ?? true,
        favoriteGroupPlacement: 'afterRecent',
        testIdPrefix: props.testIdPrefix,
    });

    return (
        <SelectionList
            testID={props.testID ?? 'new-session-machine-list'}
            rootStep={listModel.rootStep}
            selectedOptionId={listModel.selectedOptionId}
            onSelect={() => {}}
            onRequestClose={() => {}}
            autoFocusInputOnWeb
            maxHeight={props.maxHeight}
            heightBehavior={
                props.maxHeight === undefined
                    ? undefined
                    : resolvePopoverSelectionListHeightBehavior()
            }
        />
    );
}
