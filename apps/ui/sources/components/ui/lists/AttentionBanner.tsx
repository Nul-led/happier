import { HappierBanner, HappierPressable, happierPageTextMetrics } from '@happier-dev/plugin-ui/presentation';
import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { IconButton } from '@/components/ui/buttons/IconButton';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Icon, ICON_SIZE, type IconName } from '@/components/ui/icons/Icon';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { projectPluginUiTheme } from '@/components/plugins/surfaces/pluginUiThemeProjection';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

export type AttentionBannerAction = Readonly<{
    label: string;
    onPress: () => void;
    testID?: string;
    disabled?: boolean;
    loading?: boolean;
}>;

/**
 * The one tinted notice a page shows above the content it concerns: something blocks use
 * (`warning`: offline, needs sign-in) or waits on someone (`neutral`: an approval, a read-only
 * archive). It names the state and carries the next action; healthy pages never render it.
 *
 * Its own surface, not a sheet: a quiet tint of the tone with the tone's hairline on every edge, the
 * tone's glyph in the rows' icon column, the title and description on the rows' text steps, and the
 * action on the right — beneath the text when the banner is too narrow for both. It takes a section's
 * place in the page flow (one section gap above it, on the sheets' edges).
 */
export const AttentionBanner = React.memo(function AttentionBanner(props: Readonly<{
    testID: string;
    title: string;
    description?: string;
    tone?: 'warning' | 'neutral';
    action?: AttentionBannerAction | null;
    /** A second way forward (open the page that fixes it), beside the action. */
    secondaryAction?: AttentionBannerAction | null;
    /** Rare further ways forward, after the second (a conflict's Skip beside Abort). Quiet, same button step. */
    moreActions?: readonly AttentionBannerAction[];
    /**
     * Technical facts for support or an expert (raw errors, codes). Hidden behind "Details" so the
     * notice itself speaks in outcomes.
     */
    details?: readonly string[];
    accessibilityLiveRegion?: 'polite' | 'assertive';
    /** A failure the reader must hear now (a refresh that failed over cached data) is an alert. */
    announce?: 'alert';
    /** The notice can be put away (an operation's failure the reader has seen): a quiet × at its end. */
    onDismiss?: () => void;
}>) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const tone = props.tone ?? 'warning';
    const palette = tone === 'warning' ? theme.colors.state.warning : theme.colors.state.info;
    const iconName: IconName = tone === 'warning' ? 'warning' : 'info';
    const presentationTheme = React.useMemo(() => projectPluginUiTheme(theme), [theme]);
    const [detailsOpen, setDetailsOpen] = React.useState(false);
    const toggleDetails = React.useCallback(() => setDetailsOpen((open) => !open), []);
    const hasDetails = (props.details?.length ?? 0) > 0;
    const actions = props.action || props.secondaryAction || (props.moreActions?.length ?? 0) > 0 ? (
        <View style={styles.actions}>
            {props.action ? <BannerButton action={props.action} testID={`${props.testID}.action`} /> : null}
            {props.secondaryAction
                ? <BannerButton action={props.secondaryAction} testID={`${props.testID}.secondaryAction`} />
                : null}
            {(props.moreActions ?? []).map((more, index) => (
                <BannerButton key={index} action={more} testID={`${props.testID}.moreAction.${index}`} />
            ))}
        </View>
    ) : null;
    return (
        <ItemGroup surface="none">
            <HappierBanner
                testID={props.testID}
                title={props.title}
                description={props.description}
                tone={tone}
                theme={presentationTheme}
                backgroundColor={palette.background}
                borderColor={palette.border}
                announce={props.announce ?? 'none'}
                accessibilityLiveRegion={props.accessibilityLiveRegion}
                icon={<Icon name={iconName} size={ICON_SIZE.md} color={palette.foreground} />}
                titleContent={<Text style={styles.title}>{props.title}</Text>}
                descriptionContent={props.description ? <Text style={styles.description}>{props.description}</Text> : undefined}
                action={actions}
                details={<>
                    {hasDetails ? (
                        <HappierPressable
                            testID={`${props.testID}.details`}
                            accessibilityRole="button"
                            expanded={detailsOpen}
                            onPress={toggleDetails}
                            style={styles.detailsToggle}
                        >
                            <Text style={styles.detailsToggleText}>{t('common.details')}</Text>
                            <Icon name={detailsOpen ? 'caret-up' : 'caret-down'} size={ICON_SIZE.xs} color={theme.colors.text.secondary} />
                        </HappierPressable>
                    ) : null}
                    {hasDetails && detailsOpen ? (
                        <View testID={`${props.testID}.detailsContent`} style={styles.detailsContent}>
                            {props.details!.map((line, index) => (
                                <Text key={index} selectable style={styles.detailsLine}>{line}</Text>
                            ))}
                        </View>
                    ) : null}
                </>}
                dismiss={props.onDismiss ? (
                        <IconButton
                            testID={`${props.testID}.dismiss`}
                            variant="plain"
                            size={28}
                            accessibilityLabel={t('common.close')}
                            icon={<Icon name="x" size={ICON_SIZE.xs} color={theme.colors.text.secondary} />}
                            onPress={props.onDismiss}
                        />
                ) : undefined}
            />
        </ItemGroup>
    );
});

function BannerButton(props: Readonly<{ action: AttentionBannerAction; testID: string }>) {
    return (
        <RoundButton
            testID={props.action.testID ?? props.testID}
            size="small"
            display="secondary"
            title={props.action.label}
            disabled={props.action.disabled}
            loading={props.action.loading}
            onPress={props.action.onPress}
        />
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    title: {
        ...Typography.default('medium'),
        ...happierPageTextMetrics('rowTitle'),
        color: theme.colors.text.primary,
    },
    description: {
        ...Typography.default('regular'),
        ...happierPageTextMetrics('rowDescription'),
        color: theme.colors.text.secondary,
        marginTop: 2,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
    },
    detailsToggle: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 4,
        marginTop: 6,
    },
    detailsToggleText: {
        ...Typography.default('medium'),
        ...happierPageTextMetrics('rowDescription'),
        color: theme.colors.text.secondary,
    },
    detailsContent: {
        marginTop: 6,
        gap: 2,
    },
    detailsLine: {
        ...Typography.mono(),
        fontSize: 12,
        lineHeight: 17,
        color: theme.colors.text.secondary,
    },
}));
