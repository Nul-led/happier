import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { SelectionTiles, type SelectionTile } from '@/components/ui/forms/SelectionTiles';
import { getPreferredLanguage, t } from '@/text';

import type { HomeComposerSuggestion, HomeComposerSuggestionSince } from './homeComposerSuggestions';
import { useHomeComposerSuggestions } from './useHomeComposerSuggestions';

const SUGGESTION_COLUMNS = 3;
/** The shared action tiles' gap (`HappierSelectionTiles`). */
const SUGGESTION_GAP_PX = 10;
/** Three action tiles at their 180 px minimum plus two gaps; narrower columns (phones) let the tiles stack full width. */
const SUGGESTION_GRID_MIN_WIDTH_PX = 560;

export type HomeComposerSuggestionFill = Readonly<{
    prompt: string;
    placement: HomeComposerSuggestion['fill']['placement'] | null;
}>;

function formatSinceDay(since: HomeComposerSuggestionSince): string {
    const locale = getPreferredLanguage();
    if (since.kind === 'yesterday') {
        return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-1, 'day');
    }
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(new Date(since.atMs));
}

function presentSuggestion(suggestion: HomeComposerSuggestion): Readonly<{ title: string; detail: string }> {
    if (suggestion.since.kind === 'today') {
        return {
            title: t('homeComposer.summarizeProjectToday', { project: suggestion.project }),
            detail: t('homeComposer.sessionsToday', { count: suggestion.sessionCount }),
        };
    }
    const day = formatSinceDay(suggestion.since);
    return {
        title: t('homeComposer.summarizeProjectSince', { project: suggestion.project, day }),
        detail: t('homeComposer.sessionsSince', { count: suggestion.sessionCount, day }),
    };
}

/**
 * Suggestions under Home's composer. Each card names its source in its detail line; pressing one
 * fills the composer (text and where to start) and never sends. Nothing renders when no source
 * has anything real to offer.
 */
export const HubComposerSuggestions = React.memo(function HubComposerSuggestions(props: Readonly<{
    onFill: (fill: HomeComposerSuggestionFill) => void;
}>) {
    const suggestions = useHomeComposerSuggestions();
    const presented = React.useMemo(() => suggestions.map((suggestion) => ({
        suggestion,
        ...presentSuggestion(suggestion),
    })), [suggestions]);
    const tiles = React.useMemo<SelectionTile<string>[]>(() => presented.map((entry) => ({
        id: entry.suggestion.id,
        testID: `hub-composer.suggestion.${entry.suggestion.source}`,
        icon: 'clock-counter-clockwise',
        title: entry.title,
        subtitle: entry.detail,
    })), [presented]);
    const onFill = props.onFill;
    const onPress = React.useCallback((id: string) => {
        const entry = presented.find((candidate) => candidate.suggestion.id === id);
        if (!entry) return;
        onFill({ prompt: entry.title, placement: entry.suggestion.fill.placement });
    }, [onFill, presented]);

    // Cards keep the page's three-column tile rhythm: one or two suggestions take one or two
    // columns instead of stretching across the column.
    const [columnWidth, setColumnWidth] = React.useState<number | null>(null);
    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        setColumnWidth(event.nativeEvent.layout.width);
    }, []);
    const tileCount = Math.min(tiles.length, SUGGESTION_COLUMNS);
    const width = columnWidth !== null && columnWidth >= SUGGESTION_GRID_MIN_WIDTH_PX
        ? (tileCount * (columnWidth - (SUGGESTION_COLUMNS - 1) * SUGGESTION_GAP_PX)) / SUGGESTION_COLUMNS
            + (tileCount - 1) * SUGGESTION_GAP_PX
        : undefined;

    if (tiles.length === 0) return null;
    return (
        <View onLayout={onLayout}>
            <View style={width === undefined ? null : { width }}>
                <SelectionTiles
                    variant="action"
                    accessibilityLabel={t('homeComposer.suggestionsLabel')}
                    options={tiles}
                    onPress={onPress}
                />
            </View>
        </View>
    );
});
