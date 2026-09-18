import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import { Icon } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { t, type TranslationKey } from '@/text';

import type { SessionListQueryPresentation } from '@/sync/domains/session/listing/sessionListIndexPresentation';
import type { SessionListViewContext, SessionListViewFilters } from './search/sessionListViewFilters';
import {
    resolveSessionListViewEmptyState,
    type SessionListViewEmptyStateAction,
} from './sessionListViewEmptyStateModel';

const stylesheet = StyleSheet.create((theme) => ({
    emptyContainer: {
        width: '100%',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 20,
    },
    statusContainer: {
        width: '100%',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        gap: 4,
    },
    statusTitle: {
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
    statusDescription: {
        color: theme.colors.text.tertiary,
        textAlign: 'center',
    },
    statusAction: {
        marginTop: 4,
    },
}));

type SessionListViewEmptyStateProps = Readonly<{
    presentation: SessionListQueryPresentation;
    visibleSessionCount: number;
    filters: SessionListViewFilters;
    defaults: SessionListViewFilters;
    viewContext: SessionListViewContext;
    includeInactive: boolean;
    hasHiddenInactiveSessions: boolean;
    onRetry: () => void;
    onLoadMore: () => void;
    onClearFilters: () => void;
    onBrowseAllAccessible: () => void;
    onShowInactive: () => void;
}>;

function resolveAction(
    action: SessionListViewEmptyStateAction | null,
    props: SessionListViewEmptyStateProps,
): Readonly<{ titleKey: TranslationKey; onPress: () => void }> | null {
    if (action === 'retry') return { titleKey: 'common.retry', onPress: props.onRetry };
    if (action === 'load_more') return { titleKey: 'sessionsList.querySearchOlder', onPress: props.onLoadMore };
    if (action === 'clear_filters') return { titleKey: 'sessionsList.filtersClear', onPress: props.onClearFilters };
    if (action === 'browse_all_accessible') {
        return { titleKey: 'sessionsList.queryBrowseAllAccessible', onPress: props.onBrowseAllAccessible };
    }
    if (action === 'show_inactive') return { titleKey: 'sessionsList.filtersInactiveShow', onPress: props.onShowInactive };
    return null;
}

export const SessionListViewEmptyState = React.memo((props: SessionListViewEmptyStateProps) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const model = resolveSessionListViewEmptyState(props);
    if (model.mode === 'none') return null;

    const action = resolveAction(model.action, props);
    const actionButton = action ? (
        <RoundButton
            testID={`session-list-query-action:${model.action}`}
            size={model.mode === 'status' ? 'small' : 'normal'}
            display={model.mode === 'status' ? 'inverted' : 'default'}
            title={t(action.titleKey)}
            accessibilityLabel={t(action.titleKey)}
            onPress={action.onPress}
            style={model.mode === 'status' ? styles.statusAction : undefined}
        />
    ) : null;

    if (model.mode === 'status') {
        return (
            <View
                accessibilityLiveRegion="polite"
                style={styles.statusContainer}
                testID="session-list-query-status"
            >
                <Text style={styles.statusTitle}>{t(model.titleKey)}</Text>
                {model.descriptionKey ? (
                    <Text style={styles.statusDescription}>{t(model.descriptionKey)}</Text>
                ) : null}
                {actionButton}
            </View>
        );
    }

    return (
        <View
            accessibilityLiveRegion="polite"
            style={styles.emptyContainer}
            testID="session-list-query-empty-state"
        >
            <EmptyState
                titleTestID="session-list-query-empty-title"
                subtitleTestID="session-list-query-empty-description"
                icon={<Icon name="magnifying-glass" size={44} color={theme.colors.text.secondary} />}
                title={t(model.titleKey)}
                subtitle={model.descriptionKey ? t(model.descriptionKey) : undefined}
                action={actionButton}
                paddingHorizontal={0}
            />
        </View>
    );
});

SessionListViewEmptyState.displayName = 'SessionListViewEmptyState';
