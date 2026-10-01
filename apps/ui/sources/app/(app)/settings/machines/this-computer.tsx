import * as React from 'react';

import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { ItemList } from '@/components/ui/lists/ItemList';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { LocalCliPathExposureSection } from '@/components/settings/machines/localControl/LocalCliPathExposureSection';
import { LocalDaemonControlSection } from '@/components/settings/machines/localControl/LocalDaemonControlSection';
import { t } from '@/text';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { buildMachineAddHref } from '@/components/settings/machines/collection/machineCollectionModel';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { SettingRow } from '@/components/settings/shell/SettingRow';
import { MACHINES_THIS_COMPUTER_SETTINGS } from '@/components/settings/machines/machinesThisComputerSettings';
import { Icon } from '@/components/ui/icons/Icon';

export function ThisComputerSetupRoute() {
    const router = useRouter();
    const isDesktop = isDesktopHost();
    return (
        <ItemList presentation="page">
            <SettingsPageHeader description={t('settingsMachines.thisComputerPageDescription')} />
            {isDesktop ? (
                <>
                    <LocalDaemonControlSection />
                    <LocalCliPathExposureSection />
                </>
            ) : null}
            <ItemGroup title={t('settingsMachines.setupSectionTitle')}>
                <SettingRow
                    testID="settings.machineSetup.openSetupWizard"
                    icon={<Icon name="magic-wand" />}
                    setting={MACHINES_THIS_COMPUTER_SETTINGS.settings.openSetupAction}
                    subtitle={t('settingsMachines.setupRowSubtitle')}
                    onPress={() => router.push(buildMachineAddHref({ path: 'thisComputer' }))}
                />
            </ItemGroup>
        </ItemList>
    );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { ThisComputerSetupRoute as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={ThisComputerSetupRoute} />; }
