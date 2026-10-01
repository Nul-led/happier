import * as React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { describeWorkStatusBucket } from '@/components/work/status/workStatusBuckets';
import { workStatusWordStyle } from '@/components/work/status/workStatusTreatment';
import { Typography } from '@/constants/Typography';

import { BoardCardView } from '../cards/BoardCardView';
import { groupBoardCardsByStatus, type BoardCard } from '../model/boardCards';
import { BOARD_CANVAS_METRICS } from '../model/boardCanvasGeometry';

/**
 * By status (lab `boards-B2`): five columns from the one vocabulary — Needs you · Working · Finished ·
 * Idle · Offline — with every kind together. A card's column is its status, so cards are not dragged
 * between columns. On a phone the same groups stack as sections: By status is the phone projection.
 */
export const BoardByStatus = React.memo(function BoardByStatus(props: Readonly<{
    cards: readonly BoardCard[];
    onOpen: (card: BoardCard) => void;
    stacked: boolean;
}>) {
    const groups = React.useMemo(() => groupBoardCardsByStatus(props.cards), [props.cards]);
    // Stacked on a phone, an empty status takes no room; side by side, every column keeps its place.
    const shown = props.stacked ? groups.filter((group) => group.cards.length > 0) : groups;
    const columns = shown.map((group) => (
        <View key={group.bucket} testID={`board-status:${group.bucket}`} style={props.stacked ? styles.section : styles.column}>
            <View style={styles.columnHeader}>
                <Text style={[styles.columnTitle, group.bucket === 'needs_you' && group.cards.length > 0 ? workStatusWordStyle('attention') : null]}>
                    {describeWorkStatusBucket(group.bucket)}
                </Text>
                <Text style={styles.columnCount}>{group.cards.length}</Text>
            </View>
            {group.cards.map((card) => (
                <Pressable
                    key={card.key}
                    testID={`board-status-card:${card.key}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${card.title}, ${card.status.word}`}
                    onPress={() => props.onOpen(card)}
                >
                    <BoardCardView card={card} />
                </Pressable>
            ))}
        </View>
    ));
    if (props.stacked) {
        return <ScrollView testID="board-by-status" contentContainerStyle={styles.stackedContent}>{columns}</ScrollView>;
    }
    return (
        <ScrollView testID="board-by-status" horizontal contentContainerStyle={styles.columnsContent}>
            {columns}
        </ScrollView>
    );
});

const styles = StyleSheet.create((theme) => ({
    columnsContent: {
        padding: BOARD_CANVAS_METRICS.paddingPx,
        gap: 16,
        alignItems: 'flex-start',
    },
    column: {
        width: 280,
        gap: 12,
    },
    stackedContent: {
        padding: 16,
        gap: 24,
    },
    section: {
        gap: 12,
    },
    columnHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
        paddingHorizontal: 4,
    },
    columnTitle: {
        ...Typography.rowTitle(),
        color: theme.colors.text.primary,
    },
    columnCount: {
        ...Typography.rowMeta(),
        ...Typography.tabular(),
        color: theme.colors.text.tertiary,
    },
}));
