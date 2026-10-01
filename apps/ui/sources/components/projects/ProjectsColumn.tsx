import * as React from 'react';
import { View } from 'react-native';
import { usePathname } from '@/components/appShell/workspace/destinationRoute';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { destinationRowTestId, useColumnDestinations } from '@/components/appShell/destinations/ColumnDestinationRows';
import { Icon } from '@/components/ui/icons/Icon';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import {
    CollectionList,
    CollectionListGroupLabel,
    CollectionNavigationRow,
    collectionListStyles,
} from '@/components/ui/lists/collection/CollectionList';
import type { WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';
import { t } from '@/text';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';

import { ProjectsAddMenu } from './ProjectsAddMenu';
import { ProjectsListItemMenu } from './ProjectsListItemMenu';
import { resolveWorkspaceRefDisplayName } from './resolveWorkspaceRefDisplayName';
import { useProjectsListModel } from './useProjectsListModel';

/** The project a `/projects/<id>…` route has open, or `null` on the index. */
function readOpenProjectId(pathname: string): string | null {
    const match = /^\/projects\/([^/]+)/.exec(pathname);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]!);
    } catch {
        return match[1]!;
    }
}

/**
 * The Projects destination's column (design §3.2): the projects, pinned first and then per machine,
 * on the navigation plane, with the open project selected; "+" adds one. It reads the same model as
 * the Projects page, so the column and the page never disagree.
 */
export const ProjectsColumn = React.memo(function ProjectsColumn() {
    const { theme } = useUnistyles();
    const pathname = usePathname();
    const model = useProjectsListModel();
    const placed = useColumnDestinations('projects');
    const openId = readOpenProjectId(pathname);

    const projectRow = (workspaceRef: WorkspaceRefV1, pinned: boolean) => (
        <CollectionNavigationRow
            key={workspaceRef.id}
            testID={`projects-column:project:${workspaceRef.id}`}
            title={resolveWorkspaceRefDisplayName(workspaceRef)}
            icon={<Icon name="folder" />}
            selected={openId === workspaceRef.id}
            rightElement={(
                <ProjectsListItemMenu
                    theme={theme}
                    workspaceRef={workspaceRef}
                    pinAction={pinned || model.pinnedIdSet.has(workspaceRef.id) ? 'unpin' : 'pin'}
                    onTogglePinned={model.togglePinned}
                    onRename={model.renameProject}
                    onReset={model.resetProjectName}
                    onRemove={model.removeProject}
                />
            )}
            onPress={() => { model.openProject(workspaceRef.id); }}
        />
    );

    return (
        <View testID="projects-column" style={styles.column}>
            <CollectionList
                testID="projects-column:list"
                surface="plane"
                title={t('tabs.projects')}
                count={model.projectCount}
                headerAction={(
                    <ProjectsAddMenu
                        testID="projects-column:add"
                        machines={model.addFirstMachines}
                        onAdd={model.addProjectToMachine}
                    />
                )}
            >
                {placed.destinations.map((destination) => (
                    <CollectionNavigationRow
                        key={destination.id}
                        testID={destinationRowTestId(destination)}
                        title={destination.title}
                        icon={<Icon name={destination.icon} />}
                        selected={destination.id === placed.currentId}
                        onPress={() => placed.activate(destination)}
                    />
                ))}
                {!model.hasAnyProjects ? (
                    <EmptyState
                        testID="projects-column:empty"
                        layout="line"
                        title={t('projects.emptyTitle')}
                        lineDensity="compact"
                        lineRowStyle={collectionListStyles.row}
                    />
                ) : null}
                {model.groups.pinned.length > 0 ? (
                    <>
                        <CollectionListGroupLabel
                            testID="projects-column:group:pinned"
                            title={t('projects.groups.pinned')}
                            first={placed.destinations.length === 0}
                        />
                        {model.groups.pinned.map((workspaceRef) => projectRow(workspaceRef, true))}
                    </>
                ) : null}
                {model.groups.machineGroups.map((group, index) => (
                    <React.Fragment key={group.machineId}>
                        <CollectionListGroupLabel
                            testID={`projects-column:group:${group.machineId}`}
                            title={getMachineDisplayName(model.machinesById.get(group.machineId) ?? null) ?? group.machineId}
                            first={placed.destinations.length === 0 && model.groups.pinned.length === 0 && index === 0}
                        />
                        {group.items.map((workspaceRef) => projectRow(workspaceRef, false))}
                    </React.Fragment>
                ))}
            </CollectionList>
        </View>
    );
});

const styles = StyleSheet.create(() => ({
    column: {
        flex: 1,
        minHeight: 0,
    },
}));
