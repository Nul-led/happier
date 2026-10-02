import * as React from 'react';
import { useIsFocused } from '@/components/appShell/workspace/destinationRoute';

import { ItemList } from '@/components/ui/lists/ItemList';
import { t } from '@/text';
import { MachineAdministrationTargetSelector } from '@/components/settings/machines/MachineAdministrationTargetSelector';

import { PluginDiagnosticsSnapshotSection } from '../PluginMarketplaceSections';
import { PluginAccountDataEraseRecoverySection } from '../PluginAccountDataEraseRecoverySection';
import { PluginReadOnlySnapshotNotice } from '../PluginReadOnlySnapshotNotice';
import { usePluginSettingsScreenState } from '../model/usePluginSettingsScreenState';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';

/**
 * Settings → Plugins → Diagnostics.
 *
 * Advanced daemon and catalog evidence for the selected machine, deliberately
 * off the discovery path so a normal install never walks past it. It consumes
 * the same canonical screen-state owner as the rest of the plugin surfaces.
 */
export const PluginDiagnosticsScreen = React.memo(function PluginDiagnosticsScreen() {
    const isFocused = useIsFocused();
    const state = usePluginSettingsScreenState({ focused: isFocused });

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <SettingsPageHeader
                description={t('settingsPlugins.developerDiagnosticsSubtitle')}
                actions={(
                    /* Diagnostics are a property of one machine, so it is named first. */
                    <MachineAdministrationTargetSelector
                        selection={state.administrationTargetSelection}
                        testIDPrefix="settings.plugins.diagnostics.target"
                        groupTitle={t('settingsPlugins.administrationMachineTitle')}
                        presentation="chip"
                    />
                )}
            />
            {/* No machine chosen is not a disconnect: the chip above is the next action. */}
            {state.readOnlySnapshotNotice && state.administrationTargetSelection.state.kind !== 'unselected' ? (
                <PluginReadOnlySnapshotNotice
                    testID="settings.plugins.diagnostics.readOnlySnapshot"
                    reason={state.readOnlySnapshotNotice.reason}
                    onRetry={state.refreshPluginTruth}
                />
            ) : null}
            <PluginDiagnosticsSnapshotSection diagnostics={state.currentDiagnostics} />
            {/*
              * Data a removed plugin left in the Account. It needs the plugin's
              * id, which is known here from its diagnostics or from the reader,
              * and on each installed plugin's own page.
              */}
            <PluginAccountDataEraseRecoverySection testID="settings.plugins.accountDataErase" />
        </ItemList>
    );
});

export default PluginDiagnosticsScreen;
