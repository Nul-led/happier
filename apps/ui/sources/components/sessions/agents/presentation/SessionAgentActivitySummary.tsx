import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { resolveRecipientAccentColor } from '@/components/sessions/agentInput/routing/resolveRecipientAccentColor';
import { Icon } from '@/components/ui/icons/Icon';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { Text } from '@/components/ui/text/Text';

import type { SessionAgentActivityPresentation } from './sessionAgentActivityPresentation';

/**
 * One unit of Session agent work, drawn the same way everywhere.
 *
 * Deliberately a LEAF, not a card: it owns the identity block (icon, title, one state badge, the
 * secondary facts line) and nothing else — no surface, no padding, no border, no press behaviour.
 * The roster row, the Details overview card and a conversation's run reference each wrap it in
 * their own legitimate geometry and add only their own controls, which is what keeps them from
 * drifting without turning one component into a `compact`/`showActions` switchboard.
 *
 * **One badge, not two.** Attention replaces status rather than sitting beside it: attention only
 * exists while the entry is `waiting`, so "Waiting · Needs approval" states the same fact twice and
 * costs a dense row the horizontal space its title needs. The status is still spoken — the
 * resolver's `accessibilityLabel` names title, status and every pending attention kind.
 */

const stylesheet = StyleSheet.create((theme) => ({
    summary: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        minWidth: 0,
    },
    leadingIcon: {
        width: 28,
        height: 28,
        // Concentric with nothing, because a circle has no corner to match — the marker reads as a
        // token rather than as a nested surface.
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface.base,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
    },
    copy: {
        flex: 1,
        minWidth: 0,
        gap: 4,
    },
    titleRow: {
        flexDirection: 'row',
        // Centred on the title's line box, so a badge sits on the type rather than on the block.
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
    },
    title: {
        color: theme.colors.text.primary,
        // Title yields first: the badge is a fixed, short, load-bearing token, and a long title
        // pushing it off the row is how a row stops saying what state it is in.
        flexShrink: 1,
        minWidth: 0,
        fontSize: 14,
        fontWeight: '600',
    },
    facts: {
        color: theme.colors.text.secondary,
        fontSize: 12,
    },
}));

const FACT_SEPARATOR = ' · ';

export const SessionAgentActivitySummary = React.memo((props: Readonly<{
    presentation: SessionAgentActivityPresentation;
    /** Prefix for this instance's test ids, so a host keeps its existing addressing. */
    testID?: string;
}>) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { presentation } = props;
    const accentColor = presentation.accentName
        ? resolveRecipientAccentColor({ theme, accentName: presentation.accentName })
        : undefined;
    const facts = presentation.facts.length > 0 ? presentation.facts.join(FACT_SEPARATOR) : null;
    const badge = presentation.attention ?? {
        label: presentation.statusLabel,
        variant: presentation.statusVariant,
    };

    return (
        <View
            testID={props.testID}
            accessible
            accessibilityLabel={presentation.accessibilityLabel}
            style={styles.summary}
        >
            <View style={[styles.leadingIcon, accentColor ? { borderColor: accentColor } : null]}>
                <Icon
                    name={presentation.iconName}
                    size={16}
                    color={accentColor ?? theme.colors.text.secondary}
                />
            </View>
            <View style={styles.copy}>
                <View style={styles.titleRow}>
                    <Text numberOfLines={1} style={styles.title}>{presentation.title}</Text>
                    <StatusPill
                        testID={props.testID ? `${props.testID}:state` : undefined}
                        variant={badge.variant}
                        label={badge.label}
                        // A phrase like "Needs your answer" reads as chrome type; a one-word status
                        // token keeps the tracked micro-label it was designed for.
                        labelVariant={presentation.attention ? 'phrase' : 'micro'}
                        hideDot
                    />
                </View>
                {facts ? (
                    <Text
                        testID={props.testID ? `${props.testID}:facts` : undefined}
                        numberOfLines={2}
                        style={styles.facts}
                    >
                        {facts}
                    </Text>
                ) : null}
            </View>
        </View>
    );
});
