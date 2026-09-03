import * as React from 'react';
import { Animated, Easing, Platform, Pressable, View, type TextStyle, type ViewStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { Text, TextInput } from '@/components/ui/text/Text';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { t } from '@/text';

import { SessionListOrderingMenuButton, stopPressEventPropagation } from '../sessionListChrome';
import { sessionListStyles } from '../sessionListStyles';

const TAG_FILTER_ITEM_PREFIX = 'session-list-tag-filter:';
const SEARCH_INPUT_ANIMATION_MS = 170;
const MINIMUM_INTERACTIVE_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);
const MINIMUM_INTERACTIVE_TARGET_STYLE = {
    minWidth: MINIMUM_INTERACTIVE_TARGET_SIZE,
    minHeight: MINIMUM_INTERACTIVE_TARGET_SIZE,
};
const WEB_NO_FOCUS_OUTLINE_STYLE = {
    outline: 'none',
    outlineStyle: 'none',
    outlineWidth: 0,
    outlineColor: 'transparent',
    boxShadow: 'none',
} as unknown as ViewStyle;
const SEARCH_INPUT_CHROME_RESET_STYLE = {
    outline: 'none',
    outlineStyle: 'none',
    outlineWidth: 0,
    outlineColor: 'transparent',
    outlineOffset: 0,
    boxShadow: 'none',
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    appearance: 'none',
    WebkitAppearance: 'none',
} as unknown as TextStyle;

function resolveTagFromItemId(itemId: string): string | null {
    if (!itemId.startsWith(TAG_FILTER_ITEM_PREFIX)) return null;
    const tag = itemId.slice(TAG_FILTER_ITEM_PREFIX.length);
    return tag.length > 0 ? tag : null;
}

export type SessionListSearchChromeProps = Readonly<{
    allKnownTags: ReadonlyArray<string>;
    selectedTags: ReadonlyArray<string>;
    searchQuery: string;
    searchTrailingAccessory?: React.ReactNode;
    onSelectedTagsChange: (tags: string[]) => void;
    onSearchQueryChange: (query: string) => void;
    /**
     * Opens the universal Search surface with the contextual query preserved. The
     * session list never renders universal results itself.
     */
    onSearchEverything?: (query: string) => void;
}>;

/**
 * Stable, non-virtualized sibling of the one virtualized session-results list.
 *
 * The search field, tag filter and order control live here — never inside
 * virtualized row data — so typing, provider publication, filtering and
 * zero-result rebuilds cannot remount the native input. No focus timer, hidden
 * input, header anchor, or refocus-after-query workaround is needed once the
 * field's lifetime is owned by this surface.
 */
export const SessionListSearchChrome = React.memo(function SessionListSearchChrome(
    props: SessionListSearchChromeProps,
) {
    const {
        allKnownTags,
        onSearchEverything,
        onSearchQueryChange,
        onSelectedTagsChange,
        searchQuery,
        searchTrailingAccessory,
        selectedTags,
    } = props;
    const styles = sessionListStyles;
    const { theme } = useUnistyles();
    const reducedMotion = useReducedMotionPreference();
    const trimmedQuery = searchQuery.trim();
    const searchAnimation = React.useRef(new Animated.Value(trimmedQuery.length > 0 ? 1 : 0)).current;
    const [searchOpened, setSearchOpened] = React.useState(false);
    const [searchFocused, setSearchFocused] = React.useState(false);
    const [collapsedTriggerFocused, setCollapsedTriggerFocused] = React.useState(false);
    const [tagMenuOpen, setTagMenuOpen] = React.useState(false);
    const iconColor = theme.colors.text.secondary;
    const activeIconColor = theme.colors.accent.blue;
    const searchIsOpen = searchOpened || trimmedQuery.length > 0;
    const selectedTagSet = React.useMemo(() => new Set(selectedTags), [selectedTags]);

    React.useEffect(() => {
        Animated.timing(searchAnimation, {
            toValue: searchIsOpen ? 1 : 0,
            duration: reducedMotion ? 0 : SEARCH_INPUT_ANIMATION_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start();
    }, [reducedMotion, searchAnimation, searchIsOpen]);
    const animatedSearchChromeStyle = React.useMemo(() => ({
        opacity: searchAnimation,
    }), [searchAnimation]);

    const handleOpenSearch = React.useCallback((event?: unknown) => {
        stopPressEventPropagation(event);
        setSearchOpened(true);
        setSearchFocused(true);
    }, []);

    const handleSearchFocus = React.useCallback(() => {
        // Once explicitly focused, the field owns a stable open lifetime until
        // the user explicitly closes it. Native clear gestures can emit blur as
        // part of platform focus transfer; that must not remount the field.
        setSearchOpened(true);
        setSearchFocused(true);
    }, []);

    const handleSearchBlur = React.useCallback(() => {
        setSearchFocused(false);
    }, []);

    const handleSearchKeyPress = React.useCallback((event: { nativeEvent?: { key?: string } }) => {
        if (event.nativeEvent?.key !== 'Escape') return;
        onSearchQueryChange('');
        setSearchOpened(false);
        setSearchFocused(false);
    }, [onSearchQueryChange]);

    const handleTagMenuOpenChange = React.useCallback((open: boolean) => {
        setTagMenuOpen(open);
    }, []);

    const tagItems = React.useMemo((): DropdownMenuItem[] => allKnownTags.map((tag) => {
        const selected = selectedTagSet.has(tag);
        return {
            id: `${TAG_FILTER_ITEM_PREFIX}${tag}`,
            title: tag,
            icon: <Icon name="tag" size={14} color={selected ? activeIconColor : iconColor} />,
            rightElement: selected
                ? <Icon name="check" size={14} color={activeIconColor} />
                : null,
        };
    }), [activeIconColor, allKnownTags, iconColor, selectedTagSet]);

    const handleTagSelect = React.useCallback((itemId: string) => {
        const tag = resolveTagFromItemId(itemId);
        if (!tag) return;
        const nextTags = selectedTagSet.has(tag)
            ? selectedTags.filter((item) => item !== tag)
            : [...selectedTags, tag];
        onSelectedTagsChange(nextTags);
    }, [onSelectedTagsChange, selectedTagSet, selectedTags]);

    const handleSearchEverything = React.useCallback((event?: unknown) => {
        stopPressEventPropagation(event);
        onSearchEverything?.(trimmedQuery);
    }, [onSearchEverything, trimmedQuery]);

    return (
        <View style={styles.searchChrome} testID="session-list-search-chrome">
            <View style={styles.searchChromeControlsRow}>
                <Pressable
                    testID="session-list-search-trigger"
                    accessibilityRole={searchIsOpen ? undefined : 'button'}
                    accessibilityLabel={searchIsOpen ? undefined : t('sessionsList.searchSessions')}
                    onPress={searchIsOpen ? undefined : handleOpenSearch}
                    onFocus={() => setCollapsedTriggerFocused(true)}
                    onBlur={() => setCollapsedTriggerFocused(false)}
                    style={[
                        styles.headerSearchShell,
                        WEB_NO_FOCUS_OUTLINE_STYLE,
                        searchIsOpen ? styles.headerSearchShellExpanded : styles.headerSearchShellCollapsed,
                        MINIMUM_INTERACTIVE_TARGET_STYLE,
                        ((!searchIsOpen && collapsedTriggerFocused) || (searchIsOpen && searchFocused))
                            ? ({
                                outlineStyle: 'solid',
                                outlineWidth: 2,
                                outlineColor: theme.colors.border.focus,
                                outlineOffset: 2,
                            } as unknown as ViewStyle)
                            : null,
                    ]}
                >
                    <Animated.View
                        pointerEvents="none"
                        style={[styles.headerSearchShellBackdrop, animatedSearchChromeStyle]}
                    />
                    <Animated.View
                        pointerEvents="none"
                        style={[styles.headerSearchShellBorder, animatedSearchChromeStyle]}
                    />
                    <Icon
                        name="magnifying-glass"
                        size={16}
                        color={searchIsOpen ? activeIconColor : iconColor}
                        style={styles.headerSearchIcon}
                    />
                    {searchIsOpen ? (
                        <View style={styles.headerSearchInputContainer}>
                            <TextInput
                                testID="session-list-search-input"
                                accessibilityLabel={t('sessionsList.searchSessions')}
                                placeholder={t('sessionsList.searchSessionsPlaceholder')}
                                placeholderTextColor={theme.colors.text.tertiary}
                                value={searchQuery}
                                onChangeText={onSearchQueryChange}
                                onFocus={handleSearchFocus}
                                onBlur={handleSearchBlur}
                                onKeyPress={handleSearchKeyPress}
                                // Only the explicit open path focuses; a retained query restoring
                                // this surface must not steal focus on mount.
                                autoFocus={searchFocused}
                                returnKeyType="search"
                                autoCorrect={false}
                                clearButtonMode="never"
                                style={[
                                    styles.headerSearchInput,
                                    { minHeight: MINIMUM_INTERACTIVE_TARGET_SIZE },
                                    SEARCH_INPUT_CHROME_RESET_STYLE,
                                ]}
                            />
                        </View>
                    ) : null}
                    {searchIsOpen && searchTrailingAccessory !== undefined ? (
                        <View
                            testID="session-list-search-trailing-accessory"
                            pointerEvents="none"
                            accessibilityElementsHidden={true}
                            importantForAccessibility="no-hide-descendants"
                            style={styles.headerSearchTrailingAccessory}
                        >
                            {searchTrailingAccessory}
                        </View>
                    ) : null}
                </Pressable>
                {allKnownTags.length > 0 ? (
                    <DropdownMenu
                        open={tagMenuOpen}
                        onOpenChange={handleTagMenuOpenChange}
                        items={tagItems}
                        onSelect={handleTagSelect}
                        selectedId={selectedTags[0] ?? null}
                        variant="slim"
                        search={allKnownTags.length > 8}
                        searchPlaceholder={t('sessionTags.searchOrAddPlaceholder')}
                        closeOnSelect={false}
                        showCategoryTitles={false}
                        matchTriggerWidth={false}
                        maxWidthCap={220}
                        popoverPortalWebTarget="body"
                        placement="bottom"
                        popoverAnchorAlign="end"
                        trigger={({ toggle }) => (
                            <Pressable
                                testID="session-list-tag-filter-trigger"
                                style={[styles.headerActionButton, MINIMUM_INTERACTIVE_TARGET_STYLE]}
                                onPress={(event) => {
                                    stopPressEventPropagation(event);
                                    toggle();
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={t('sessionsList.filterByTags')}
                            >
                                <Icon
                                    name="tag"
                                    size={16}
                                    color={selectedTags.length > 0 ? activeIconColor : iconColor}
                                />
                            </Pressable>
                        )}
                    />
                ) : null}
                <SessionListOrderingMenuButton placement="bottom" />
            </View>
            {onSearchEverything && trimmedQuery.length > 0 ? (
                <Pressable
                    testID="session-list-search-everything"
                    accessibilityRole="button"
                    accessibilityLabel={t('sessionsList.searchEverythingFor', { query: trimmedQuery })}
                    onPress={handleSearchEverything}
                    style={[styles.searchChromeEscalationRow, MINIMUM_INTERACTIVE_TARGET_STYLE]}
                >
                    <Icon name="magnifying-glass" size={14} color={iconColor} />
                    <Text style={styles.searchChromeEscalationText}>
                        {t('sessionsList.searchEverythingFor', { query: trimmedQuery })}
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
});
