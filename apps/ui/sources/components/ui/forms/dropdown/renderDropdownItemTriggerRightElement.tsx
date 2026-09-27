import * as React from 'react';
import { View } from 'react-native';


import {
    ITEM_CHEVRON_SIZE,
    ITEM_TITLE_TEXT_METRICS,
} from '@/components/ui/lists/itemDensityMetrics';
import { Text } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import { FIELD_BOX_METRICS, fieldBoxShapeStyle } from '@/components/ui/forms/fieldBox';
import { t } from '@/text';


export function renderDropdownItemTriggerRightElement(params: Readonly<{
    detail: string | null;
    open: boolean;
    detailColor: string;
    chevronColor: string;
    detailDensity?: 'comfortable' | 'cozy' | 'compact' | 'tight';
    /**
     * Render the current value as a bordered field (configuration pages) instead of bare value text.
     * Colours come from the caller, which reads the theme.
     */
    field?: Readonly<{ borderColor: string; backgroundColor: string; valueColor: string; placeholderColor: string }>;
    /**
     * Configuration pages only: what an empty selection says ("Choose…") instead of a blank field or a
     * bare chevron. Grouped triggers leave it out and show only the chevron.
     */
    placeholder?: string;
    /** Colour of the placeholder beside a bare chevron (the field supplies its own). */
    placeholderColor?: string;
}>) {
    const resolvedDensity = params.detailDensity ?? 'comfortable';
    const chevron = (
        <Icon
            name={params.open ? 'caret-up' : 'caret-down'}
            size={ITEM_CHEVRON_SIZE[resolvedDensity]}
            color={params.chevronColor}
        />
    );
    const detailTextStyle = ITEM_TITLE_TEXT_METRICS[resolvedDensity];

    if (params.field) {
        return (
            <View
                style={[fieldBoxShapeStyle, {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    minWidth: 132,
                    maxWidth: 280,
                    borderColor: params.field.borderColor,
                    backgroundColor: params.field.backgroundColor,
                }]}
            >
                <Text
                    style={{
                        flex: 1,
                        // An empty field says it is waiting for a choice rather than showing a blank box.
                        color: params.detail ? params.field.valueColor : params.field.placeholderColor,
                        fontSize: FIELD_BOX_METRICS.fontSizePx,
                        lineHeight: FIELD_BOX_METRICS.lineHeightPx,
                    }}
                    numberOfLines={1}
                >
                    {params.detail || params.placeholder || t('common.choose')}
                </Text>
                {chevron}
            </View>
        );
    }

    const value = params.detail || params.placeholder || null;
    if (!value) return chevron;

    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
            <Text
                style={{
                    color: params.detail ? params.detailColor : (params.placeholderColor ?? params.detailColor),
                    marginRight: 8,
                    flexShrink: 1,
                    ...(detailTextStyle ?? {}),
                }}
                numberOfLines={1}
            >
                {value}
            </Text>
            {chevron}
        </View>
    );
}
