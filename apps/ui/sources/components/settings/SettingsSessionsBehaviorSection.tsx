import * as React from 'react';

import type { SettingsBelowFoldSectionsProps } from '@/components/settings/settingsBelowFoldSectionTypes';
import { SettingsCatalogOverviewGroup } from '@/components/settings/SettingsCatalogOverviewGroup';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';
import { t } from '@/text';

type SettingsSessionsBehaviorSectionProps = Readonly<Pick<SettingsBelowFoldSectionsProps,
    | 'automationsNeedLocalEnablement'
    | 'onNavigate'
    | 'router'
    | 'showAutomations'
>>;

export const SettingsSessionsBehaviorSection = React.memo(function SettingsSessionsBehaviorSection({
    automationsNeedLocalEnablement,
    onNavigate,
    router,
    showAutomations,
}: SettingsSessionsBehaviorSectionProps) {
    return (
        <SettingsCatalogOverviewGroup
            groupId="groupSessionsBehavior"
            onNavigate={onNavigate}
            router={router}
            resolveSubtitle={(page, defaultSubtitle) => (
                page.id === 'session'
                    ? t('settingsSessionPages.runtime.pageDescription')
                    : defaultSubtitle
            )}
            append={showAutomations ? (
                <Item
                    testID="settings-workflow-run-settings"
                    title={t('workflows.destination.runSettingsPage.title')}
                    icon={<Icon name="tree-structure" />}
                    subtitle={automationsNeedLocalEnablement
                        ? t('settingsFeatures.expAutomationsSubtitle')
                        : t('workflows.destination.runSettingsPage.description')}
                    // Workflow run settings live under the Workflows destination (FIN 04 §3.5); while
                    // Automations is off on this device the row leads to the switch that turns it on.
                    onPress={() => router.push(automationsNeedLocalEnablement ? SETTINGS_ROUTES.features : '/workflows/settings')}
                />
            ) : null}
        />
    );
});
