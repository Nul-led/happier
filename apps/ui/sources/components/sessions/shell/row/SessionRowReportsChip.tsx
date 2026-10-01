import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';

/**
 * The lead row's sub-session chip (ORC §3.8, D-S4; lab `session-H`): what its direct reports are doing,
 * read from the server's awareness `reports` count — never from the rows the list happens to hold.
 *
 * Quiet unless a report needs the person (an amber dot and the count, like every "needs you" in the
 * list); otherwise how many are still working; nothing once they have all settled.
 */

const stylesheet = StyleSheet.create((theme) => ({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginRight: 2,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.colors.state.warning.foreground,
    },
    needsYou: {
        ...Typography.default('semiBold'),
        ...Typography.tabular(),
        fontSize: 11,
        color: theme.colors.state.warning.foreground,
    },
    working: {
        ...Typography.default(),
        ...Typography.tabular(),
        fontSize: 10,
        color: theme.colors.text.secondary,
    },
}));

export function hasSessionRowReportsChip(reports: Session['reports'] | undefined): boolean {
    if (!reports) return false;
    return reports.needsYou > 0 || reports.working + reports.stalled > 0;
}

export const SessionRowReportsChip = React.memo((props: Readonly<{
    sessionId: string;
    reports: NonNullable<Session['reports']>;
}>) => {
    const styles = stylesheet;
    const { needsYou, working, stalled } = props.reports;
    if (needsYou > 0) {
        return (
            <View
                testID={`session-row-reports-chip:${props.sessionId}`}
                accessible
                accessibilityLabel={t('sessionWork.list.reportsNeedYou', { count: needsYou })}
                style={styles.chip}
            >
                <View style={styles.dot} />
                <Text style={styles.needsYou}>{needsYou}</Text>
            </View>
        );
    }
    const active = working + stalled;
    if (active <= 0) return null;
    return (
        <View testID={`session-row-reports-chip:${props.sessionId}`} style={styles.chip}>
            <Text numberOfLines={1} style={styles.working}>{t('sessionWork.list.reportsWorking', { count: active })}</Text>
        </View>
    );
});
