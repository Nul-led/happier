import * as React from 'react';

import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { t, type TranslationKey } from '@/text';

import type { ApiTokenExpiryPreset } from './apiTokenSettingsController';

const EXPIRY_PRESETS: readonly ApiTokenExpiryPreset[] = ['30d', '90d', '1y', 'none'];
const EXPIRY_PRESET_LABEL_KEYS = {
    '30d': 'settingsApiTokens.create.expiryOptions.30d',
    '90d': 'settingsApiTokens.create.expiryOptions.90d',
    '1y': 'settingsApiTokens.create.expiryOptions.1y',
    none: 'settingsApiTokens.create.expiryOptions.none',
} satisfies Record<ApiTokenExpiryPreset, TranslationKey>;

/**
 * When a new token expires: the person's choice, "No expiry" included. The one control for every
 * token this account creates (API tokens and embed keys), resolved by the token controller.
 */
export const ApiTokenExpiryChoiceItem = React.memo(function ApiTokenExpiryChoiceItem(props: Readonly<{
    value: ApiTokenExpiryPreset;
    onChange: (next: ApiTokenExpiryPreset) => void;
    disabled?: boolean;
    title?: string;
    subtitle?: string;
    testIDPrefix?: string;
}>) {
    return (
        <SegmentedChoiceItem
            title={props.title ?? t('settingsApiTokens.create.expiry')}
            subtitle={props.subtitle}
            subtitleLines={0}
            testIDPrefix={props.testIDPrefix ?? 'settings-api-tokens-expiry'}
            options={EXPIRY_PRESETS.map((preset) => ({ id: preset, label: t(EXPIRY_PRESET_LABEL_KEYS[preset]) }))}
            value={props.value}
            disabled={props.disabled}
            onChange={props.onChange}
        />
    );
});
