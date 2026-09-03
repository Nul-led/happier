import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';
import type { ApprovalActionFieldsPresentation } from './approvalFieldValues';

export const ActionApprovalFieldsCard = React.memo(function ActionApprovalFieldsCard(props: Readonly<{
    presentation: ApprovalActionFieldsPresentation;
}>) {
    const rows = props.presentation.rows;
    if (rows.length === 0) return null;

    return (
        <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('approvals.details')}</Text>
            <View style={styles.rows}>
                {rows.map((row) => (
                    <View key={row.path} style={styles.row}>
                        <Text style={styles.label}>{row.title}</Text>
                        {row.kind === 'unrepresentable' ? (
                            <View testID="approvals.unrepresentable-details" style={styles.unrepresentable}>
                                <Text style={styles.unrepresentableTitle}>{t('approvals.unsafeDetailsTitle')}</Text>
                                <Text style={styles.unrepresentableBody}>{t('approvals.unsafeDetailsBody')}</Text>
                            </View>
                        ) : null}
                        {row.kind === 'structuredAnswers' ? (
                            <View style={styles.structuredAnswers}>
                                {row.answers.map((answer, index) => (
                                    <View key={`${answer.question}:${index}`} style={styles.structuredAnswer}>
                                        <Text style={styles.question}>{answer.question}</Text>
                                        {answer.values.map((value, valueIndex) => (
                                            <Text key={`${value}:${valueIndex}`} style={styles.value}>{value}</Text>
                                        ))}
                                    </View>
                                ))}
                            </View>
                        ) : null}
                        {row.kind === 'value' ? (
                            <Text style={styles.value}>{row.value}</Text>
                        ) : null}
                    </View>
                ))}
            </View>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    card: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.elevated,
        padding: 16,
        gap: 12,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: theme.colors.text.primary,
    },
    rows: {
        gap: 10,
    },
    row: {
        gap: 4,
    },
    label: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        fontWeight: '600',
    },
    value: {
        fontSize: 14,
        color: theme.colors.text.primary,
        lineHeight: 20,
    },
    structuredAnswers: {
        gap: 10,
    },
    structuredAnswer: {
        gap: 2,
    },
    question: {
        fontSize: 14,
        color: theme.colors.text.primary,
        lineHeight: 20,
        fontWeight: '600',
    },
    unrepresentable: {
        gap: 2,
    },
    unrepresentableTitle: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '600',
        color: theme.colors.state.danger.foreground,
    },
    unrepresentableBody: {
        fontSize: 14,
        lineHeight: 20,
        color: theme.colors.text.secondary,
    },
}));
