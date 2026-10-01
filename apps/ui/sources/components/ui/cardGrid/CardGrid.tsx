import * as React from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { ItemGroupColumn, ItemGroupColumns } from '@/components/ui/lists/ItemGroupColumns';

import { CARD_GRID, resolveCardGridColumns } from './cardGridMetrics';

/**
 * A card that takes more than one column: `2`, or the whole `row` (it falls back to the columns
 * there are, so on a phone every card is one column). Plain children take one column each.
 */
export function CardGridCell(props: Readonly<{ span?: 2 | 'row'; children: React.ReactNode }>) {
    return <>{props.children}</>;
}

/**
 * The card grid: the shared column owner (`ItemGroupColumns`) at the card rhythm (`CARD_GRID`). Each
 * child is one card; cards in a row share its height. It measures its own width (never the window) and passes
 * the resolved count down, so the count has one owner, and reports it for callers that lay things
 * over the grid (the set-up block morph).
 */
export const CardGrid = React.memo(function CardGrid(props: Readonly<{
    children: React.ReactNode;
    /** At most this many columns (default three). */
    columns?: 1 | 2 | 3;
    onColumnCountChange?: (columns: number) => void;
    testID?: string;
    style?: StyleProp<ViewStyle>;
}>) {
    const requested = props.columns ?? CARD_GRID.columns;
    const [columns, setColumns] = React.useState(1);
    const onColumnCountChange = props.onColumnCountChange;
    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        const width = event.nativeEvent.layout.width;
        if (!Number.isFinite(width) || width <= 0) return;
        const next = resolveCardGridColumns(width, requested);
        setColumns((current) => (current === next ? current : next));
    }, [requested]);
    React.useEffect(() => { onColumnCountChange?.(columns); }, [columns, onColumnCountChange]);

    return (
        <View testID={props.testID} style={props.style} onLayout={onLayout}>
            <ItemGroupColumns
                activeColumns={columns}
                paddingHorizontal={0}
                paddingVertical={0}
                columnGap={CARD_GRID.gapPx}
                rowGap={CARD_GRID.gapPx}
            >
                {React.Children.map(props.children, (child) => {
                    if (child == null || child === false) return null;
                    const span = React.isValidElement<Readonly<{ span?: 2 | 'row' }>>(child) && child.type === CardGridCell
                        ? child.props.span
                        : undefined;
                    return (
                        <ItemGroupColumn span={span === 'row' ? requested : span} style={cellStyle}>{child}</ItemGroupColumn>
                    );
                })}
            </ItemGroupColumns>
        </View>
    );
});

// A card fills its cell, so every card in a row is as tall as the tallest.
const cellStyle: ViewStyle = { flex: 1 };
