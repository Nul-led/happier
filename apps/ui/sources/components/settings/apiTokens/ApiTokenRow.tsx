import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { AccountApiTokenSummaryV1 } from '@happier-dev/protocol';

import { collectionListStyles } from '@/components/ui/lists/collection/CollectionList';
import { Item } from '@/components/ui/lists/Item';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { t } from '@/text';

import {
    buildApiTokenAccessSummaryParts,
    buildApiTokenRowPresentation,
    formatApiTokenAccessSummary,
    resolveApiTokenStatusLabel,
    type ApiTokenAccessSummaryNames,
} from './apiTokenSettingsPresentation';

const stylesheet = StyleSheet.create({
    pills: {
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center',
    },
});

/**
 * One token in the collection: its label, a quiet pill only for an embed or an expiry that needs
 * attention, and its access in one line. The same row in the rail (compact, selected by route) and
 * on the list page (with a chevron).
 */
export const ApiTokenRow = React.memo(function ApiTokenRow(props: Readonly<{
    token: AccountApiTokenSummaryV1;
    names: ApiTokenAccessSummaryNames;
    nowMs: number;
    variant: 'rail' | 'page';
    selected?: boolean;
    disabled?: boolean;
    onPress: (token: AccountApiTokenSummaryV1) => void;
}>) {
    const { theme } = useUnistyles();
    const presentation = buildApiTokenRowPresentation({ token: props.token, nowMs: props.nowMs });
    const summary = formatApiTokenAccessSummary(buildApiTokenAccessSummaryParts({
        token: props.token,
        nowMs: props.nowMs,
        names: props.names,
    }));
    const statusLabel = resolveApiTokenStatusLabel(presentation);
    const rail = props.variant === 'rail';
    const { onPress, token } = props;
    const press = React.useCallback(() => onPress(token), [onPress, token]);

    return (
        <Item
            testID={`settings-api-tokens-row:${props.token.tokenId}`}
            title={props.token.label}
            titleStyle={presentation.status === 'expired' ? { color: theme.colors.text.secondary } : undefined}
            titleAccessory={presentation.embedBacked || statusLabel ? (
                <View style={stylesheet.pills}>
                    {presentation.embedBacked ? (
                        <StatusPill
                            testID={`settings-api-tokens-embed:${props.token.tokenId}`}
                            variant="neutral"
                            hideDot
                            label={t('settingsApiTokens.embedPill')}
                        />
                    ) : null}
                    {statusLabel ? (
                        <StatusPill
                            testID={`settings-api-tokens-status:${props.token.tokenId}`}
                            variant={presentation.statusVariant}
                            hideDot
                            label={statusLabel}
                        />
                    ) : null}
                </View>
            ) : undefined}
            subtitle={summary}
            subtitleLines={1}
            accessibilityLabel={t('settingsApiTokens.rowAccessibilityLabel', {
                label: props.token.label,
                state: [statusLabel ?? t('settingsApiTokens.status.active'), summary].join(', '),
            })}
            accessibilityHint={presentation.embedBacked ? t('settingsApiTokens.embedRowHint') : undefined}
            selected={rail ? props.selected === true : undefined}
            density={rail ? 'compact' : undefined}
            showChevron={!rail}
            pressableStyle={rail ? collectionListStyles.row : undefined}
            disabled={props.disabled}
            onPress={press}
        />
    );
});
