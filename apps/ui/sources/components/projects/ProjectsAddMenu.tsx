import * as React from 'react';

import { IconButton } from '@/components/ui/buttons/IconButton';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { t } from '@/text';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';

import type { ProjectsListModel } from './useProjectsListModel';

/**
 * Add a project: choose a folder on a machine. With one machine the "+" goes straight to its folder
 * browser; with several it asks which machine first. The add flow itself is the Projects model's.
 */
export const ProjectsAddMenu = React.memo(function ProjectsAddMenu(props: Readonly<{
    machines: ProjectsListModel['addFirstMachines'];
    onAdd: ProjectsListModel['addProjectToMachine'];
    /** Replaces the "+" trigger (the primary button of the "no project open" page). */
    renderTrigger?: (open: () => void) => React.ReactNode;
    testID: string;
}>) {
    const [open, setOpen] = React.useState(false);
    const { machines, onAdd } = props;
    const items = React.useMemo((): ReadonlyArray<DropdownMenuItem> => machines.map((machine) => ({
        id: machine.id,
        testID: `${props.testID}:machine:${machine.id}`,
        title: getMachineDisplayName(machine) ?? machine.metadata?.host ?? machine.id,
        icon: undefined,
    })), [machines, props.testID]);
    if (machines.length === 0) return null;
    const soleMachine = machines.length === 1 ? machines[0]! : null;
    const renderTrigger = (toggle: () => void) => {
        const press = soleMachine ? () => { void onAdd(soleMachine.id); } : toggle;
        return props.renderTrigger ? props.renderTrigger(press) : (
            <IconButton
                testID={props.testID}
                iconName="plus"
                accessibilityLabel={t('projects.actions.addProject')}
                tooltip={t('projects.actions.addProject')}
                variant="plain"
                onPress={press}
            />
        );
    };
    return (
        <DropdownMenu
            testID={`${props.testID}:menu`}
            open={open && soleMachine === null}
            onOpenChange={setOpen}
            items={items}
            onSelect={(machineId) => {
                setOpen(false);
                void onAdd(machineId);
            }}
            placement="bottom"
            popoverAnchorAlign="end"
            matchTriggerWidth={false}
            maxWidthCap={320}
            popoverPortalWebTarget="body"
            trigger={({ toggle }) => renderTrigger(toggle)}
        />
    );
});
