import type { SettingsBelowFoldSectionsProps } from '@/components/settings/settingsBelowFoldSectionTypes';
import { SettingsCatalogOverviewGroup } from '@/components/settings/SettingsCatalogOverviewGroup';

type SettingsFilesAndSourceControlSectionProps = Readonly<Pick<SettingsBelowFoldSectionsProps,
    | 'onNavigate'
    | 'router'
>>;

export function SettingsFilesAndSourceControlSection({
    onNavigate,
    router,
}: SettingsFilesAndSourceControlSectionProps) {
    return (
        <SettingsCatalogOverviewGroup
            groupId="groupFilesAndSourceControl"
            onNavigate={onNavigate}
            router={router}
        />
    );
}
