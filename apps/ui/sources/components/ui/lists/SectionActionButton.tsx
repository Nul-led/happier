import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Icon, type IconName } from '@/components/ui/icons/Icon';

/**
 * A section's trailing action (`ItemGroup` `action`): a quiet text button with a glyph, such as
 * "+ Add member", "Refresh" or "Invite". It never competes with the page's one primary action.
 */
export const SectionActionButton = React.memo(function SectionActionButton(props: Readonly<{
    testID?: string;
    title: string;
    icon: IconName;
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
    accessibilityLabel?: string;
    /** For an action that opens something in place (a picker under the section): whether it is open. */
    expanded?: boolean;
}>) {
    const { theme } = useUnistyles();
    return (
        <RoundButton
            testID={props.testID}
            size="small"
            display="inverted"
            title={props.title}
            accessibilityLabel={props.accessibilityLabel}
            leading={<Icon name={props.icon} size={14} color={theme.colors.text.secondary} />}
            textStyle={{ color: theme.colors.text.secondary }}
            disabled={props.disabled}
            loading={props.loading}
            expanded={props.expanded}
            onPress={props.onPress}
        />
    );
});
