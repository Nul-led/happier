import * as React from 'react';

import { ItemList } from '@/components/ui/lists/ItemList';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { t } from '@/text';

import { AddMachineMenu, MachineCollectionList } from './collection/MachineCollectionList';
import { useMachineAddOptions } from './collection/useMachineAddOptions';
import { useMachinesSettingsViewModel } from './machinesSettingsViewModel';

/**
 * The Machines collection as a page: this computer, the machines of each Home, their pools, and the
 * ways to add one. It is the collection's index where no rail shows (phones, narrow windows), and a
 * self-contained screen elsewhere (the onboarding tour stage). Rows open their detail.
 */
export const MachinesSettingsView = React.memo(function MachinesSettingsView() {
    const viewModel = useMachinesSettingsViewModel();
    const addOptions = useMachineAddOptions(viewModel.visibleMachineGroups);
    return (
        <ItemList>
            <SettingsPageHeader
                testID="settings.machines.header"
                description={t('settingsMachines.pageDescription')}
                actions={<AddMachineMenu options={addOptions} replaceInCollection={false} />}
            />
            <MachineCollectionList variant="page" viewModel={viewModel} addOptions={addOptions} />
        </ItemList>
    );
});
