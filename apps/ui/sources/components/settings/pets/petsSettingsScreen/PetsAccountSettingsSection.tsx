import * as React from 'react';

import { Switch } from '@/components/ui/forms/Switch';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SegmentedChoiceItem, type SegmentedChoiceOption } from '@/components/ui/lists/SegmentedChoiceItem';
import { t } from '@/text';
import { SettingRow, SettingAnchor } from '@/components/settings/shell/SettingRow';
import { PETS_SETTINGS } from '@/components/settings/pets/petsSettings';

import { PetCompanionSizeSlider } from './PetCompanionSizeSlider';
import type { PetEnabledOverride } from './types';

type PetsAccountSettingsSectionProps = Readonly<{
    companionSizeScale: number;
    onCompanionSizeScaleChange: (value: number) => void;
    onPetsEnabledChange: (enabled: boolean) => void;
    onPetsEnabledOverrideChange: (override: PetEnabledOverride) => void;
    overrideOptions: ReadonlyArray<SegmentedChoiceOption<PetEnabledOverride>>;
    petsEnabled: boolean;
    petsEnabledOverride: PetEnabledOverride;
}>;

export function PetsAccountSettingsSection(props: PetsAccountSettingsSectionProps): React.ReactElement {
    return (
        <ItemGroup title={t('settingsPets.accountTitle')} description={t('settingsPets.accountDescription')}>
            <SettingRow
                setting={PETS_SETTINGS.settings.enabled}
                rightElement={(
                    <Switch
                        testID="settings-pets-enabled"
                        value={props.petsEnabled}
                        onValueChange={props.onPetsEnabledChange}
                    />
                )}
                showChevron={false}
            />
            <SettingAnchor setting={PETS_SETTINGS.settings.deviceOverride}>
                <SegmentedChoiceItem<PetEnabledOverride>
                    testID="settings-pets-device-override"
                    testIDPrefix="settings-pets-device-override"
                    title={t(PETS_SETTINGS.settings.deviceOverride.titleKey)}
                    subtitle={t('settingsPets.deviceOverrideSubtitle')}
                    options={props.overrideOptions}
                    value={props.petsEnabledOverride}
                    onChange={props.onPetsEnabledOverrideChange}
                />
            </SettingAnchor>
            <SettingAnchor setting={PETS_SETTINGS.settings.companionSize}>
                <PetCompanionSizeSlider
                    value={props.companionSizeScale}
                    onValueChange={props.onCompanionSizeScaleChange}
                />
            </SettingAnchor>
        </ItemGroup>
    );
}
