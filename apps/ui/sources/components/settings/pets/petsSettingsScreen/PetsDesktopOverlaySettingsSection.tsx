import * as React from 'react';

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SegmentedChoiceItem, type SegmentedChoiceOption } from '@/components/ui/lists/SegmentedChoiceItem';
import { t } from '@/text';
import { SettingAnchor, SettingRow } from '@/components/settings/shell/SettingRow';
import { PETS_SETTINGS } from '@/components/settings/pets/petsSettings';

import { isDesktopPetOverlayVisibilityModeOverride } from './helpers';
import type {
    DesktopPetOverlayVisibilityModeOverride,
    PetEnabledOverride,
} from './types';

type PetsDesktopOverlaySettingsSectionProps = Readonly<{
    desktopOverlayDefaultEnabled: boolean;
    desktopOverlayVisibilityModeOpen: boolean;
    desktopPetOverlayEnabledOverride: PetEnabledOverride;
    desktopPetOverlayVisibilityModeOverride: DesktopPetOverlayVisibilityModeOverride;
    onDefaultEnabledChange: (enabled: boolean) => void;
    onDesktopOverlayOverrideChange: (override: PetEnabledOverride) => void;
    onDesktopOverlayVisibilityModeOverrideChange: (override: DesktopPetOverlayVisibilityModeOverride) => void;
    onDesktopOverlayVisibilityModeOpenChange: (open: boolean) => void;
    onResetPosition: () => void;
    overrideOptions: ReadonlyArray<SegmentedChoiceOption<PetEnabledOverride>>;
    visibilityModeItems: DropdownMenuItem[];
}>;

export function PetsDesktopOverlaySettingsSection(props: PetsDesktopOverlaySettingsSectionProps): React.ReactElement {
    return (
        <ItemGroup title={t('settingsPets.desktopOverlayTitle')} description={t('settingsPets.desktopOverlayDescription')}>
            <SettingRow
                testID="settings-pets-desktop-overlay-enabled"
                setting={PETS_SETTINGS.settings.desktopOverlayEnabled}
                rightElement={(
                    <Switch
                        value={props.desktopOverlayDefaultEnabled}
                        onValueChange={props.onDefaultEnabledChange}
                    />
                )}
                showChevron={false}
            />
            <SettingAnchor setting={PETS_SETTINGS.settings.desktopOverlayDeviceOverride}>
                <SegmentedChoiceItem<PetEnabledOverride>
                    testID="settings-pets-desktop-overlay-device-override"
                    testIDPrefix="settings-pets-desktop-overlay-device-override"
                    title={t(PETS_SETTINGS.settings.desktopOverlayDeviceOverride.titleKey)}
                    subtitle={t('settingsPets.deviceOverrideSubtitle')}
                    options={props.overrideOptions}
                    value={props.desktopPetOverlayEnabledOverride}
                    onChange={props.onDesktopOverlayOverrideChange}
                />
            </SettingAnchor>
            <SettingAnchor setting={PETS_SETTINGS.settings.desktopOverlayVisibilityMode}>
                <DropdownMenu
                    testID="settings-pets-desktop-overlay-visibility-mode"
                    open={props.desktopOverlayVisibilityModeOpen}
                    onOpenChange={props.onDesktopOverlayVisibilityModeOpenChange}
                    selectedId={props.desktopPetOverlayVisibilityModeOverride}
                    items={props.visibilityModeItems}
                    onSelect={(itemId) => {
                        if (isDesktopPetOverlayVisibilityModeOverride(itemId)) {
                            props.onDesktopOverlayVisibilityModeOverrideChange(itemId);
                        }
                    }}
                    itemTrigger={{
                        title: t(PETS_SETTINGS.settings.desktopOverlayVisibilityMode.titleKey),
                        subtitle: t('settingsPets.desktopOverlayVisibilityModeSubtitle'),
                    }}
                    rowKind="item"
                />
            </SettingAnchor>
            <Item
                testID="settings-pets-desktop-overlay-reset-position"
                title={t('settingsPets.desktopOverlayResetPositionTitle')}
                subtitle={t('settingsPets.desktopOverlayResetPositionSubtitle')}
                onPress={props.onResetPosition}
                showChevron={false}
            />
        </ItemGroup>
    );
}
