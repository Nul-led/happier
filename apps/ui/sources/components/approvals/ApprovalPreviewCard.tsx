import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';

/** The requester's one-line summary of what approving will do, when it sent one. */
export function readApprovalPreviewSummary(preview: unknown): string | null {
    if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return null;
    const summary = typeof (preview as { summary?: unknown }).summary === 'string'
        ? (preview as { summary: string }).summary.trim()
        : '';
    return summary || null;
}

export const ApprovalPreviewCard = React.memo(function ApprovalPreviewCard(props: Readonly<{ preview: unknown }>) {
    const summary = React.useMemo(() => readApprovalPreviewSummary(props.preview), [props.preview]);
    if (!summary) return null;

    return (
        <View style={styles.card}>
            <Text style={styles.summary}>{summary}</Text>
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    // Sheet content of the approval's "Request" section: the section owns the chrome.
    card: {
        gap: 4,
    },
    summary: {
        fontSize: 14,
        color: theme.colors.text.secondary,
        lineHeight: 20,
    },
}));
