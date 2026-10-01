import React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { DelegateOutputV1 } from '@happier-dev/protocol';
import {
    ExecutionRunResultLayout,
    type ExecutionRunResultPresentation,
} from '@/components/sessions/runs/ExecutionRunResultLayout';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

/**
 * A delegated task's result: what was done, in words, then its deliverables. It has no primary of
 * its own — the deliverables are the result. The transcript shows it as a card (`message`); the Run
 * page shows it as the page itself (`page`, agents lab RP1).
 */
export function DelegateOutputMessageCard(props: Readonly<{
    payload: DelegateOutputV1;
    presentation?: ExecutionRunResultPresentation;
    /** Page only: what closes the result's body (the Run's steps disclosure). */
    after?: React.ReactNode;
}>) {
    const styles = stylesheet;
    const deliverables = props.payload.deliverables ?? [];

    return (
        <ExecutionRunResultLayout presentation={props.presentation ?? 'message'} testID="delegate-output" after={props.after}>
            {props.presentation === 'page' ? null : (
                <Text selectable accessibilityRole="header" style={styles.headerText}>{t('delegation.output.title')}</Text>
            )}
            <Text selectable style={styles.lead}>{props.payload.summary}</Text>

            {deliverables.length > 0 ? (
                <View style={styles.section}>
                    <Text selectable accessibilityRole="header" style={styles.sectionTitle}>{t('delegation.output.deliverablesTitle')}</Text>
                    <View style={styles.sheet}>
                        {deliverables.slice(0, 30).map((d, index) => (
                            <View key={d.id} style={[styles.deliverableRow, index > 0 ? styles.deliverableDivider : null]}>
                                <Text selectable style={styles.deliverableTitle}>{d.title}</Text>
                                {d.details ? <Text selectable style={styles.deliverableDetails}>{d.details}</Text> : null}
                            </View>
                        ))}
                    </View>
                </View>
            ) : null}
        </ExecutionRunResultLayout>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    headerText: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        fontSize: 15,
    },
    lead: {
        ...Typography.default(),
        color: theme.colors.text.primary,
        fontSize: 15,
        lineHeight: 22,
    },
    section: {
        gap: 10,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        fontSize: 15,
    },
    sheet: {
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        paddingHorizontal: 14,
    },
    deliverableRow: {
        gap: 4,
        paddingVertical: 12,
    },
    deliverableDivider: {
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.default,
    },
    deliverableTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        fontSize: 14,
    },
    deliverableDetails: {
        ...Typography.default(),
        color: theme.colors.text.secondary,
        fontSize: 13.5,
        lineHeight: 19,
    },
}));
