import * as React from 'react';
import { I18nManager, Image, Platform, Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { PinIcon } from '@/components/sessions/shell/sessionPinIcons';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { resolveTouchTargetFloorPx } from '@/components/ui/interactiveTargetSize';
import { t } from '@/text';
import { toTestIdSafeValue } from '@/utils/ui/toTestIdSafeValue';
import { Icon } from '@/components/ui/icons/Icon';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { resolveHappierTabKeySelection } from '@happier-dev/plugin-ui/presentation';
import { DETAILS_TAB_STRIP_METRICS as M } from '@/components/appShell/panes/details/header/detailsTabHeaderMetrics';
import { shadowLevelStyle } from '@/shadowElevation';

type ScrollPropagationEvent = Readonly<{ stopPropagation?: () => void }>;
type DocumentTabWebPressableProps = React.ComponentPropsWithRef<typeof Pressable> & Readonly<{
    onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
}>;

const DocumentTabWebPressable = Pressable as unknown as React.ComponentType<DocumentTabWebPressableProps>;

export type DocumentTabStripTestIds = Readonly<{
    tab?: (tabKey: string) => string | null | undefined;
    tabPin?: (tabKey: string) => string | null | undefined;
    tabUnpin?: (tabKey: string) => string | null | undefined;
    tabClose?: (tabKey: string) => string | null | undefined;
    tabFavicon?: (tabKey: string) => string | null | undefined;
    tabSpinner?: (tabKey: string) => string | null | undefined;
    tabUnsaved?: (tabKey: string) => string | null | undefined;
}>;

/**
 * Generic, kind-agnostic per-tab leading-glyph presentation. A consumer surface (e.g. the browser
 * `browser-view` tab) supplies a live favicon URL and/or loading flag per tab; the canonical strip
 * renders a spinner while loading, then the favicon, falling back to the per-kind icon. This is the
 * single home for tab leading chrome — the browser no longer ships a bespoke tab strip.
 */
export type DocumentTabPresentation = Readonly<{
    faviconUrl?: string | null;
    isLoading?: boolean;
}>;

export type DocumentTabItem = Readonly<{
    key: string;
    title: string;
    subtitle?: string | null;
    isPreview: boolean;
    isPinned: boolean;
    canPin?: boolean;
}>;

export type DocumentTabStripProps<T extends DocumentTabItem> = Readonly<{
    tabs: readonly T[];
    activeTabKey: string | null;
    accessibilityLabel: string;
    onActivate: (key: string) => void;
    onPin: (key: string) => void;
    onUnpin: (key: string) => void;
    onClose: (key: string) => void;
    renderLeadingIcon: (tab: T, active: boolean) => React.ReactNode;
    resolveTabPresentation?: ((tab: T) => DocumentTabPresentation | null | undefined) | null;
    tabNativeId: (key: string) => string;
    panelNativeId: (key: string) => string;
    unsavedTabKeys?: ReadonlySet<string>;
    testIds?: DocumentTabStripTestIds;
    /**
     * `strip` (default): the Details strip — tabs scroll, each shows its pin and close.
     * `bar`: the workspace bar (workspace lab T) — tabs shrink instead of scrolling (the consumer
     * passes only the tabs that fit), a pinned tab is its mark alone, and close appears on hover and
     * on the open tab in one always-reserved trailing slot. Pinning lives in the tab's menu.
     */
    variant?: 'strip' | 'bar';
    /**
     * `bar` only. `raised`: the open tab is lifted onto paper — the focused pane's tab, the one
     * focus signal. `quiet`: the open tab of a pane that is not focused takes a selection tint.
     */
    activeEmphasis?: 'raised' | 'quiet';
    /** `bar` only: a tab's menu, from a right click or a long press. */
    onTabMenu?: (key: string, event: unknown) => void;
    /** `bar` only: the tablist's own height (30 in the title strip, 28 in a pane's own strip). */
    barTabHeightPx?: number;
}>;

/** The bar variant's measures (workspace lab T: 30 tall in the title strip, 28 in a pane strip). */
export const DOCUMENT_TAB_BAR_METRICS = Object.freeze({
    tabHeightPx: 30,
    tabRadiusPx: 9,
    tabPaddingStartPx: 10,
    tabPaddingEndPx: 5,
    tabGapPx: 7,
    tabMinWidthPx: 120,
    tabMaxWidthPx: 212,
    glyphBoxPx: 16,
    trailingSlotPx: 18,
    trailingRadiusPx: 5,
    stripGapPx: 2,
});
const B = DOCUMENT_TAB_BAR_METRICS;

// Details lab 2 (`dl-strip`): tabs sit borderless on the strip; the open one takes the selection
// fill, a preview tab reads in italics, a pinned tab shows its pin and an edited one its dot.
const stylesheet = StyleSheet.create((theme) => ({
    tabsScroll: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
    },
    tabsContent: {
        alignItems: 'center',
        gap: M.tabGapPx,
    },
    tab: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: M.tabRadiusPx,
        maxWidth: M.tabMaxWidthPx,
        flexShrink: 0,
    },
    tabContent: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingLeft: M.tabPaddingStartPx,
        paddingRight: 2,
        minHeight: M.tabHeightPx,
    },
    tabActive: {
        backgroundColor: theme.colors.surface.elevated,
    },
    tabLabel: {
        flexShrink: 1,
        ...M.tabLabel,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    tabLabelActive: {
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
    },
    tabLabelPreview: {
        fontStyle: 'italic',
    },
    tabCopy: {
        flexShrink: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
    },
    tabSubtitle: {
        ...M.tabSubtitle,
        color: theme.colors.text.tertiary,
        ...Typography.default(),
    },
    tabActions: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingRight: M.tabPaddingEndPx,
    },
    unsavedDot: {
        width: M.tabUnsavedDotPx,
        height: M.tabUnsavedDotPx,
        borderRadius: M.tabUnsavedDotPx / 2,
        backgroundColor: theme.colors.text.secondary,
    },
    favicon: {
        width: M.tabGlyphPx,
        height: M.tabGlyphPx,
        borderRadius: 3,
    },
    bar: {
        flexShrink: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: B.stripGapPx,
        overflow: 'hidden',
    },
    barTab: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: B.tabRadiusPx,
        // Tabs shrink toward their minimum only when crowded; the consumer moves the rest behind
        // "+N" before that, so a short title keeps its natural width (workspace lab V).
        minWidth: 0,
        maxWidth: B.tabMaxWidthPx,
        flexShrink: 1,
    },
    barTabPinned: {
        minWidth: 0,
        flexShrink: 0,
    },
    barTabOpen: {
        flexShrink: 0,
    },
    barTabHovered: {
        backgroundColor: theme.colors.surface.ripple,
    },
    barTabQuiet: {
        backgroundColor: theme.colors.surface.ripple,
    },
    barTabRaised: {
        backgroundColor: theme.colors.surface.base,
        ...shadowLevelStyle(theme.colors.shadowLevels[1]),
    },
    barTabPress: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        gap: B.tabGapPx,
        paddingLeft: B.tabPaddingStartPx,
    },
    barTabPressPinned: {
        paddingLeft: 0,
        justifyContent: 'center',
    },
    barGlyph: {
        width: B.glyphBoxPx,
        height: B.glyphBoxPx,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    /** Pinned tabs (marks alone) lead; a short hairline separates them from the rest. */
    barPinSeparator: {
        width: StyleSheet.hairlineWidth,
        height: 16,
        marginHorizontal: 5,
        backgroundColor: theme.colors.border.strong,
        flexShrink: 0,
    },
    barTrailing: {
        paddingRight: B.tabPaddingEndPx,
        paddingLeft: 2,
    },
    barTrailingSlot: {
        width: B.trailingSlotPx,
        height: B.trailingSlotPx,
        alignItems: 'center',
        justifyContent: 'center',
    },
}));

export function DocumentTabStrip<T extends DocumentTabItem>(props: DocumentTabStripProps<T>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    // A finger gets the platform touch floor; a precise pointer keeps the dense strip (details lab 2),
    // with its pin and close still at least the WCAG 2.5.8 target.
    const touchFloorPx = resolveTouchTargetFloorPx(Platform.OS);
    const interactiveTargetStyle = React.useMemo(() => (touchFloorPx === null ? null : {
        minWidth: touchFloorPx,
        minHeight: touchFloorPx,
    }), [touchFloorPx]);
    const actionSize = Math.max(M.tabActionTargetPx, touchFloorPx ?? 0);
    const tabFocusTargetsRef = React.useRef(new Map<string, { focus?: () => void }>());
    const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLElement>, currentIndex: number) => {
        const key = event.key;
        const nextIndex = resolveHappierTabKeySelection({
            tabs: props.tabs,
            key,
            currentIndex,
            rtl: I18nManager.isRTL,
        });
        if (nextIndex === null) return;
        event.preventDefault();
        const nextTab = props.tabs[nextIndex];
        if (!nextTab) return;
        props.onActivate(nextTab.key);
        if (nextIndex !== currentIndex) tabFocusTargetsRef.current.get(nextTab.key)?.focus?.();
    }, [props.tabs, props.onActivate]);

    if (props.variant === 'bar') {
        return (
            <View
                style={styles.bar}
                accessibilityRole="tablist"
                accessibilityLabel={props.accessibilityLabel}
            >
                {props.tabs.map((tab, tabIndex) => (
                    <React.Fragment key={tab.key}>
                    {tabIndex > 0 && props.tabs[tabIndex - 1]?.isPinned && !tab.isPinned
                        ? <View style={styles.barPinSeparator} />
                        : null}
                    <DocumentBarTab
                        tab={tab}
                        index={tabIndex}
                        active={props.activeTabKey ? tab.key === props.activeTabKey : false}
                        emphasis={props.activeEmphasis ?? 'raised'}
                        unsaved={props.unsavedTabKeys?.has(tab.key) === true}
                        heightPx={props.barTabHeightPx ?? B.tabHeightPx}
                        actionSize={actionSize}
                        strip={props}
                        onKeyDown={handleKeyDown}
                        registerFocusTarget={(target) => {
                            if (target) tabFocusTargetsRef.current.set(tab.key, target);
                            else tabFocusTargetsRef.current.delete(tab.key);
                        }}
                    />
                    </React.Fragment>
                ))}
            </View>
        );
    }

    return (
        <ScrollView
            horizontal
            style={styles.tabsScroll}
            contentContainerStyle={styles.tabsContent}
            showsHorizontalScrollIndicator={false}
            accessibilityRole="tablist"
            accessibilityLabel={props.accessibilityLabel}
        >
            {props.tabs.map((tab, tabIndex) => {
                const isActive = props.activeTabKey ? tab.key === props.activeTabKey : false;
                const isUnsaved = props.unsavedTabKeys?.has(tab.key) === true;
                const safeTabKey = toTestIdSafeValue(tab.key);
                const presentation = props.resolveTabPresentation?.(tab) ?? null;
                return (
                    <View
                        key={tab.key}
                        style={[styles.tab, isActive ? styles.tabActive : null]}
                    >
                        <DocumentTabWebPressable
                            ref={(target) => {
                                if (target) tabFocusTargetsRef.current.set(tab.key, target);
                                else tabFocusTargetsRef.current.delete(tab.key);
                            }}
                            onPress={() => props.onActivate(tab.key)}
                            onKeyDown={Platform.OS === 'web'
                                ? (event) => handleKeyDown(event, tabIndex)
                                : undefined}
                            testID={props.testIds?.tab?.(safeTabKey) ?? undefined}
                            style={[
                                styles.tabContent,
                                interactiveTargetStyle,
                            ]}
                            accessibilityRole="tab"
                            accessibilityLabel={t('session.detailsPanel.openTabA11y', { title: tab.title })}
                            accessibilityState={{ selected: isActive }}
                            aria-selected={isActive}
                            nativeID={props.tabNativeId(tab.key)}
                            aria-controls={props.panelNativeId(tab.key)}
                            tabIndex={isActive ? 0 : -1}
                        >
                            {presentation?.isLoading ? (
                                <ActivitySpinner
                                    size={M.tabGlyphPx - 3}
                                    color={theme.colors.text.secondary}
                                    testID={props.testIds?.tabSpinner?.(safeTabKey) ?? undefined}
                                />
                            ) : presentation?.faviconUrl ? (
                                <Image
                                    source={{ uri: presentation.faviconUrl }}
                                    style={styles.favicon}
                                    testID={props.testIds?.tabFavicon?.(safeTabKey) ?? undefined}
                                />
                            ) : props.renderLeadingIcon(tab, isActive)}
                            <View style={styles.tabCopy}>
                                <Text
                                    style={[
                                        styles.tabLabel,
                                        isActive ? styles.tabLabelActive : null,
                                        tab.isPreview ? styles.tabLabelPreview : null,
                                    ]}
                                    numberOfLines={1}
                                >
                                    {tab.title}
                                </Text>
                                {typeof tab.subtitle === 'string' && tab.subtitle.trim().length > 0 ? (
                                    <Text style={styles.tabSubtitle} numberOfLines={1}>
                                        {tab.subtitle}
                                    </Text>
                                ) : null}
                            </View>
                        </DocumentTabWebPressable>
                        <View style={styles.tabActions}>
                            {tab.isPreview || tab.canPin ? (
                                <IconButton
                                    onPress={(event: unknown) => {
                                        if (event && typeof (event as ScrollPropagationEvent).stopPropagation === 'function') {
                                            (event as ScrollPropagationEvent).stopPropagation?.();
                                        }
                                        props.onPin(tab.key);
                                    }}
                                    testID={props.testIds?.tabPin?.(safeTabKey) ?? undefined}
                                    accessibilityLabel={`${t('session.detailsPanel.pinTabA11y')}: ${tab.title}`}
                                    tooltip={`${t('session.detailsPanel.pinTabA11y')}: ${tab.title}`}
                                    variant="plain"
                                    size={actionSize}
                                    minimumInteractiveTargetSize={actionSize}
                                    iconSize={12}
                                    icon={<PinIcon size={12} color={theme.colors.text.tertiary} />}
                                />
                            ) : tab.isPinned ? (
                                <IconButton
                                    onPress={(event: unknown) => {
                                        if (event && typeof (event as ScrollPropagationEvent).stopPropagation === 'function') {
                                            (event as ScrollPropagationEvent).stopPropagation?.();
                                        }
                                        props.onUnpin(tab.key);
                                    }}
                                    testID={props.testIds?.tabUnpin?.(safeTabKey) ?? undefined}
                                    accessibilityLabel={`${t('session.detailsPanel.unpinTabA11y')}: ${tab.title}`}
                                    tooltip={`${t('session.detailsPanel.unpinTabA11y')}: ${tab.title}`}
                                    variant="plain"
                                    size={actionSize}
                                    minimumInteractiveTargetSize={actionSize}
                                    iconSize={12}
                                    icon={<PinIcon size={12} color={theme.colors.text.secondary} />}
                                />
                            ) : null}
                            <IconButton
                                onPress={(event: unknown) => {
                                    if (event && typeof (event as ScrollPropagationEvent).stopPropagation === 'function') {
                                        (event as ScrollPropagationEvent).stopPropagation?.();
                                    }
                                    props.onClose(tab.key);
                                }}
                                testID={props.testIds?.tabClose?.(safeTabKey) ?? undefined}
                                accessibilityLabel={`${isUnsaved
                                    ? t('detailsSurface.chrome.closeUnsavedTabA11y')
                                    : t('session.detailsPanel.closeTabA11y')}: ${tab.title}`}
                                tooltip={`${isUnsaved
                                    ? t('detailsSurface.chrome.closeUnsavedTabA11y')
                                    : t('session.detailsPanel.closeTabA11y')}: ${tab.title}`}
                                variant="plain"
                                size={actionSize}
                                minimumInteractiveTargetSize={actionSize}
                                iconSize={M.tabCloseGlyphPx}
                                icon={isUnsaved ? (
                                    <View
                                        testID={props.testIds?.tabUnsaved?.(safeTabKey) ?? undefined}
                                        style={styles.unsavedDot}
                                    />
                                ) : (
                                    <Icon name="x" size={M.tabCloseGlyphPx} color={theme.colors.text.tertiary} />
                                )}
                            />
                        </View>
                    </View>
                );
            })}
        </ScrollView>
    );
}

function stopPropagation(event: unknown) {
    if (event && typeof (event as ScrollPropagationEvent).stopPropagation === 'function') {
        (event as ScrollPropagationEvent).stopPropagation?.();
    }
}

/**
 * One tab of the bar variant. Its own hover state reveals close in the reserved trailing slot, so the
 * tab never changes width under the pointer (workspace lab: "hover never changes width").
 */
function DocumentBarTab<T extends DocumentTabItem>(props: Readonly<{
    tab: T;
    index: number;
    active: boolean;
    emphasis: 'raised' | 'quiet';
    unsaved: boolean;
    heightPx: number;
    actionSize: number;
    strip: DocumentTabStripProps<T>;
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>, currentIndex: number) => void;
    registerFocusTarget: (target: { focus?: () => void } | null) => void;
}>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [hovered, setHovered] = React.useState(false);
    const { tab, strip } = props;
    const safeTabKey = toTestIdSafeValue(tab.key);
    const presentation = strip.resolveTabPresentation?.(tab) ?? null;
    const pinned = tab.isPinned;
    const showClose = !pinned && (props.active || hovered || props.unsaved);
    const openMenu = strip.onTabMenu
        ? (event: unknown) => {
            (event as { preventDefault?: () => void } | null)?.preventDefault?.();
            strip.onTabMenu?.(tab.key, event);
        }
        : undefined;
    const closeLabel = `${props.unsaved
        ? t('detailsSurface.chrome.closeUnsavedTabA11y')
        : t('session.detailsPanel.closeTabA11y')}: ${tab.title}`;
    return (
        <View
            style={[
                styles.barTab,
                { height: props.heightPx },
                pinned ? [styles.barTabPinned, { width: props.heightPx }] : null,
                props.active ? styles.barTabOpen : null,
                hovered && !props.active ? styles.barTabHovered : null,
                props.active ? (props.emphasis === 'raised' ? styles.barTabRaised : styles.barTabQuiet) : null,
            ]}
            {...(Platform.OS === 'web' ? {
                onPointerEnter: () => setHovered(true),
                onPointerLeave: () => setHovered(false),
            } : null)}
        >
            <DocumentTabWebPressable
                ref={(target) => props.registerFocusTarget(target as { focus?: () => void } | null)}
                onPress={() => strip.onActivate(tab.key)}
                onLongPress={openMenu}
                {...(Platform.OS === 'web' && openMenu ? { onContextMenu: openMenu } : null)}
                onKeyDown={Platform.OS === 'web'
                    ? (event) => props.onKeyDown(event, props.index)
                    : undefined}
                testID={strip.testIds?.tab?.(safeTabKey) ?? undefined}
                style={[styles.barTabPress, pinned ? styles.barTabPressPinned : null, { height: props.heightPx }]}
                accessibilityRole="tab"
                accessibilityLabel={t('session.detailsPanel.openTabA11y', { title: tab.title })}
                accessibilityState={{ selected: props.active }}
                aria-selected={props.active}
                nativeID={strip.tabNativeId(tab.key)}
                aria-controls={strip.panelNativeId(tab.key)}
                tabIndex={props.active ? 0 : -1}
            >
                <View style={styles.barGlyph}>
                    {presentation?.isLoading ? (
                        <ActivitySpinner
                            size={M.tabGlyphPx - 3}
                            color={theme.colors.text.secondary}
                            testID={strip.testIds?.tabSpinner?.(safeTabKey) ?? undefined}
                        />
                    ) : presentation?.faviconUrl ? (
                        <Image
                            source={{ uri: presentation.faviconUrl }}
                            style={styles.favicon}
                            testID={strip.testIds?.tabFavicon?.(safeTabKey) ?? undefined}
                        />
                    ) : strip.renderLeadingIcon(tab, props.active || hovered)}
                </View>
                {pinned ? null : (
                    <Text
                        style={[
                            styles.tabLabel,
                            props.active || hovered ? { color: theme.colors.text.primary } : null,
                            props.active ? styles.tabLabelActive : null,
                            tab.isPreview ? styles.tabLabelPreview : null,
                            { flexShrink: 1 },
                        ]}
                        numberOfLines={1}
                    >
                        {tab.title}
                    </Text>
                )}
            </DocumentTabWebPressable>
            {pinned ? null : (
                <View style={styles.barTrailing}>
                    <View style={styles.barTrailingSlot}>
                        {showClose ? (
                            <IconButton
                                onPress={(event: unknown) => {
                                    stopPropagation(event);
                                    strip.onClose(tab.key);
                                }}
                                testID={strip.testIds?.tabClose?.(safeTabKey) ?? undefined}
                                accessibilityLabel={closeLabel}
                                tooltip={closeLabel}
                                tooltipPlacement="bottom"
                                variant="plain"
                                size={B.trailingSlotPx}
                                minimumInteractiveTargetSize={props.actionSize}
                                iconSize={M.tabCloseGlyphPx}
                                icon={props.unsaved && !hovered ? (
                                    <View
                                        testID={strip.testIds?.tabUnsaved?.(safeTabKey) ?? undefined}
                                        style={styles.unsavedDot}
                                    />
                                ) : (
                                    <Icon name="x" size={M.tabCloseGlyphPx} color={theme.colors.text.tertiary} />
                                )}
                            />
                        ) : null}
                    </View>
                </View>
            )}
        </View>
    );
}
