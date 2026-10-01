import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { HappierStep, happierPageTextMetrics } from '@happier-dev/plugin-ui/presentation';

import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { projectPluginUiTheme } from '@/components/plugins/surfaces/pluginUiThemeProjection';

export type SetupStep = Readonly<{
    key: string;
    /** `done` shows a check, `current` rings the number, the rest wait (default). */
    state?: 'done' | 'current' | 'upcoming';
    /** A sentence (styled here) or a node the caller styles (a sentence with an aside). */
    title: React.ReactNode;
    detail?: string;
    /** What the step needs from the person: the code, a button, a field, the live wait. */
    body?: React.ReactNode;
    testID?: string;
}>;

/**
 * The one numbered-step anatomy of a set-up block (Home's "Add your phone", Connected services'
 * sign-in flows): a marker per step, the step in words, its detail, and what it asks for beneath.
 * `plain` is a list of instructions (sentences, no step titles), as the pairing panel reads.
 */
export function SetupSteps(props: Readonly<{
    steps: readonly SetupStep[];
    plain?: boolean;
    testID?: string;
}>) {
    const { theme } = useUnistyles();
    const presentationTheme = React.useMemo(() => projectPluginUiTheme(theme), [theme]);
    return (
        <View testID={props.testID} style={props.plain ? styles.listPlain : styles.list} accessibilityRole="list">
            {props.steps.map((step, index) => {
                const state = step.state ?? 'upcoming';
                return (
                    <HappierStep key={step.key} testID={step.testID} marker={{ kind: 'number', value: index + 1 }}
                        numberState={state} theme={presentationTheme} title={step.title}
                        stateGlyph={<Icon name="check" size={12} color={theme.colors.state.success.foreground} />}
                        titleContent={typeof step.title === 'string' ? (
                                <Text style={props.plain ? styles.plainTitle : [styles.title, state === 'done' ? styles.titleDone : null]}>
                                    {step.title}
                                </Text>
                            ) : step.title}>
                            {step.detail ? <Text style={styles.detail}>{step.detail}</Text> : null}
                            {step.body ? <View style={styles.body}>{step.body}</View> : null}
                    </HappierStep>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    list: {
        gap: 14,
    },
    listPlain: {
        gap: 9,
    },
    title: {
        ...Typography.default('semiBold'),
        ...happierPageTextMetrics('rowTitle'),
        paddingTop: 1,
        color: theme.colors.text.primary,
    },
    titleDone: {
        ...Typography.default('medium'),
        color: theme.colors.text.secondary,
    },
    plainTitle: {
        ...Typography.default(),
        ...happierPageTextMetrics('rowDescription'),
        color: theme.colors.text.primary,
    },
    detail: {
        ...Typography.default(),
        ...happierPageTextMetrics('rowDescription'),
        marginTop: 2,
        color: theme.colors.text.secondary,
    },
    body: {
        marginTop: 10,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
    },
}));
