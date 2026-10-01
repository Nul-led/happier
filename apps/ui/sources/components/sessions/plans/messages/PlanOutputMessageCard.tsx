import React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { PlanOutputV1 } from '@happier-dev/protocol';
import {
    ExecutionRunResultLayout,
    type ExecutionRunResultPresentation,
} from '@/components/sessions/runs/ExecutionRunResultLayout';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { sync } from '@/sync/sync';
import { t } from '@/text';
import { fireAndForget } from '@/utils/system/fireAndForget';

/**
 * A plan's result: its summary in words, its sections, risks and milestones, and one primary —
 * Adopt plan. The transcript shows it as a card (`message`); the Run page shows it as the page
 * itself with Adopt plan pinned at its foot (`page`, agents lab RP1).
 */
export function PlanOutputMessageCard(props: Readonly<{
    payload: PlanOutputV1;
    sessionId: string;
    canSendMessages: boolean;
    presentation?: ExecutionRunResultPresentation;
    /** Page only: what closes the result's body (the Run's steps disclosure). */
    after?: React.ReactNode;
}>) {
    const styles = stylesheet;
    const [error, setError] = React.useState<string | null>(null);
    const [isSending, setIsSending] = React.useState(false);
    const canSendMessagesRef = React.useRef(props.canSendMessages === true);
    const sections = props.payload.sections ?? [];
    const risks = props.payload.risks ?? [];
    const milestones = props.payload.milestones ?? [];

    React.useLayoutEffect(() => {
        canSendMessagesRef.current = props.canSendMessages === true;
    }, [props.canSendMessages]);

    const handleAdopt = React.useCallback(() => {
        if (!canSendMessagesRef.current) return;
        fireAndForget((async () => {
            setError(null);
            setIsSending(true);
            try {
                const wire = {
                    kind: 'plan_output.v1',
                    runRef: props.payload.runRef,
                    summary: props.payload.summary,
                    sections: props.payload.sections,
                    risks: props.payload.risks ?? [],
                    milestones: props.payload.milestones ?? [],
                    recommendedBackendId: props.payload.recommendedBackendId,
                };
                const text = `@happier/plan.adopt\n${JSON.stringify(wire)}`;
                await sync.submitMessage(props.sessionId, text, 'Adopt plan', undefined, {
                    callerSurface: 'plan_output_adopt',
                });
            } catch (e) {
                setError(e instanceof Error ? e.message : t('session.planOutput.failedToAdopt'));
            } finally {
                setIsSending(false);
            }
        })(), { tag: 'PlanOutputMessageCard.adoptPlan' });
    }, [props.payload, props.sessionId]);

    return (
        <ExecutionRunResultLayout
            presentation={props.presentation ?? 'message'}
            testID="plan-output"
            after={props.after}
            footActions={props.canSendMessages === true ? (
                <RoundButton
                    testID="adopt-plan-button"
                    size="small"
                    title={isSending ? t('session.planOutput.sending') : t('session.planOutput.adoptPlan')}
                    accessibilityLabel={t('session.planOutput.a11y.adoptPlan')}
                    disabled={isSending}
                    loading={isSending}
                    onPress={handleAdopt}
                />
            ) : null}
        >
            {props.presentation === 'page' ? null : (
                <Text selectable accessibilityRole="header" style={styles.headerText}>{t('session.planOutput.title')}</Text>
            )}
            <Text selectable style={styles.lead}>{props.payload.summary}</Text>

            {sections.slice(0, 10).map((section) => (
                <View key={section.title} style={styles.section}>
                    <Text selectable accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>
                    {section.items.slice(0, 12).map((item, idx) => (
                        <Text selectable key={`${section.title}-${idx}`} style={styles.sectionItem}>
                            {item}
                        </Text>
                    ))}
                </View>
            ))}

            {props.payload.recommendedBackendId ? (
                <View style={styles.section}>
                    <Text selectable accessibilityRole="header" style={styles.sectionTitle}>{t('session.planOutput.recommendedBackend')}</Text>
                    <Text selectable style={styles.sectionItem}>{props.payload.recommendedBackendId}</Text>
                </View>
            ) : null}

            {risks.length > 0 ? (
                <View style={styles.section}>
                    <Text selectable accessibilityRole="header" style={styles.sectionTitle}>{t('session.planOutput.risks')}</Text>
                    {risks.slice(0, 12).map((risk, idx) => (
                        <Text selectable key={`risk-${idx}`} style={styles.sectionItem}>
                            {risk}
                        </Text>
                    ))}
                </View>
            ) : null}

            {milestones.length > 0 ? (
                <View style={styles.section}>
                    <Text selectable accessibilityRole="header" style={styles.sectionTitle}>{t('session.planOutput.milestones')}</Text>
                    {milestones.slice(0, 12).map((m, idx) => (
                        <View key={`ms-${idx}`} style={styles.milestone}>
                            <Text selectable style={styles.milestoneTitle}>{m.title}</Text>
                            {m.details ? <Text selectable style={styles.sectionItem}>{m.details}</Text> : null}
                        </View>
                    ))}
                </View>
            ) : null}

            {error ? <Text selectable style={styles.errorText}>{error}</Text> : null}
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
        gap: 6,
    },
    sectionTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        fontSize: 14,
    },
    sectionItem: {
        ...Typography.default(),
        color: theme.colors.text.secondary,
        fontSize: 13.5,
        lineHeight: 19,
    },
    milestone: {
        gap: 2,
    },
    milestoneTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        fontSize: 13.5,
    },
    errorText: {
        ...Typography.default(),
        color: theme.colors.state.danger.foreground,
        fontSize: 13,
    },
}));
