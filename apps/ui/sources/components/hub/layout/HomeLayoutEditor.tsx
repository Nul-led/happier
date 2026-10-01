import * as React from 'react';
import { Platform, Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Switch } from '@/components/ui/forms/Switch';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SectionActionButton } from '@/components/ui/lists/SectionActionButton';
import { useListInlineReorder } from '@/components/ui/lists/useListInlineReorder';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import {
    TREE_DROP_OVERLAY_KIND_NONE,
    TreeDropOverlay,
    type TreeDropOverlayKind,
    type TreeDropOverlaySharedValues,
} from '@/components/ui/treeDragDrop';
import type { WidgetCandidate } from '@/components/widgets/widgetCatalog';
import { t } from '@/text';

import { findHomeHubBuiltinSection, homeHubSectionTitle } from '../homeHubSections';
import { homeHubWidgetSectionId, type HomeHubSection } from './homeHubLayout';
import { useHomeHubLayout, type HomeHubLayout } from './useHomeHubLayout';

type EditorRow =
    | Readonly<{ id: string; kind: 'section'; section: HomeHubSection<WidgetCandidate> }>
    | Readonly<{ id: string; kind: 'available'; widget: WidgetCandidate }>;

/**
 * Customize Home: one list of the built-in sections and the widgets plugins offer, each named with
 * its source. A grip drags a section to a new place (⌥↑ / ⌥↓ from the keyboard), a switch shows or
 * hides it; "Start a session" and "Needs your attention" are always shown. Dismissed setup steps
 * come back from the last row. Everything is saved on the Account, so the page behind updates
 * live. Home's Customize popover and Settings → Appearance render this one editor.
 */
export const HomeLayoutEditor = React.memo(function HomeLayoutEditor(props: Readonly<{
    title?: string;
    /** `popover`: Home's Customize popover, headed by its own title, Reset and purpose line. */
    presentation?: 'section' | 'popover';
}>) {
    const layout = useHomeHubLayout();
    const placed = React.useMemo(
        () => layout.sections.map((section) => ({ id: section.id, section })),
        [layout.sections],
    );
    const overlayShared = useDropOverlaySharedValues();
    const reorder = useListInlineReorder({
        items: placed,
        enabled: placed.length > 1,
        overlayShared,
        onCommitOrder: layout.reorder,
    });
    const rows: EditorRow[] = [
        ...reorder.frozenItems.map((item) => ({ id: item.id, kind: 'section' as const, section: item.section })),
        ...layout.available.map((widget) => ({ id: homeHubWidgetSectionId(widget.key), kind: 'available' as const, widget })),
    ];

    const reset = (
        <SectionActionButton
            testID="home-layout.reset"
            title={t('homeIndex.reset')}
            icon="arrow-arc-left"
            disabled={layout.isDefault}
            onPress={layout.reset}
        />
    );
    const popover = props.presentation === 'popover';

    return (
        <>
            {popover ? (
                <View style={styles.popoverHeader}>
                    <View style={styles.popoverTitleRow}>
                        <Text style={styles.popoverTitle} accessibilityRole="header">{t('homeIndex.customizeTitle')}</Text>
                        {reset}
                    </View>
                    <Text style={styles.popoverDescription}>{t('homeIndex.customizeDescription')}</Text>
                </View>
            ) : null}
        <ItemGroup
            // In the popover the rows sit on the popover's own surface, at list density (lab I6).
            {...(popover ? { surface: 'none' as const, density: 'compact' as const } : {
                title: props.title ?? t('homeIndex.customizeTitle'),
                description: t('homeIndex.customizeDescription'),
                action: reset,
            })}
        >
            {/* The rows and the drop line share one container: the line's position is measured from the first row. */}
            <View style={styles.rows}>
                {rows.map((row, index) => (
                    <EditorRowView
                        key={row.id}
                        row={row}
                        index={index}
                        layout={layout}
                        reorder={reorder}
                        showDivider={index < rows.length - 1 || layout.hiddenSetupStepCount > 0}
                    />
                ))}
                <View pointerEvents="none" style={styles.overlay}>
                    <TreeDropOverlay shared={overlayShared} indentPx={0} testID="home-layout.dropLine" />
                </View>
            </View>
            {layout.hiddenSetupStepCount > 0 ? (
                <Item
                    testID="home-layout.hiddenSetupSteps"
                    title={t('homeIndex.hiddenSetupSteps')}
                    detail={t('homeIndex.showAgain', { count: layout.hiddenSetupStepCount })}
                    showChevron={false}
                    onPress={layout.showHiddenSetupSteps}
                />
            ) : null}
        </ItemGroup>
        </>
    );
});

function useDropOverlaySharedValues(): TreeDropOverlaySharedValues {
    const overlayVisible = useSharedValue(0);
    const overlayKind = useSharedValue<TreeDropOverlayKind>(TREE_DROP_OVERLAY_KIND_NONE);
    const overlayTop = useSharedValue(0);
    const overlayHeight = useSharedValue(0);
    const overlayLeft = useSharedValue(0);
    const overlayRight = useSharedValue(0);
    const overlayDepth = useSharedValue(0);
    return React.useMemo(() => ({
        overlayVisible,
        overlayKind,
        overlayTop,
        overlayHeight,
        overlayLeft,
        overlayRight,
        overlayDepth,
    }), [overlayDepth, overlayHeight, overlayKind, overlayLeft, overlayRight, overlayTop, overlayVisible]);
}

function rowIcon(row: EditorRow): IconName {
    if (row.kind === 'available') return row.widget.icon;
    if (row.section.kind === 'widget') return row.section.widget.icon;
    return findHomeHubBuiltinSection(row.section.id)?.icon ?? 'squares-four';
}

function rowSubtitle(row: EditorRow): string {
    if (row.kind === 'available') return row.widget.pluginName;
    if (row.section.kind === 'widget') return row.section.widget.pluginName;
    return findHomeHubBuiltinSection(row.section.id)?.description() ?? t('homeIndex.builtIn');
}

function EditorRowView(props: Readonly<{
    row: EditorRow;
    index: number;
    layout: HomeHubLayout;
    reorder: ReturnType<typeof useListInlineReorder<{ id: string; section: HomeHubSection<WidgetCandidate> }>>;
    showDivider: boolean;
}>) {
    const { theme } = useUnistyles();
    const { row, layout, reorder } = props;
    const title = row.kind === 'available' ? row.widget.title : homeHubSectionTitle(row.section);
    const movable = row.kind === 'section';
    const alwaysShown = row.kind === 'section' && !row.section.hideable;
    const shown = row.kind === 'section' && !row.section.hidden;
    const last = layout.sections.length - 1;
    const onLayout = React.useCallback((event: LayoutChangeEvent) => reorder.onRowLayout(row.id, event), [reorder, row.id]);
    const move = React.useCallback((step: -1 | 1) => layout.move(row.id, step), [layout, row.id]);

    return (
        <Animated.View style={movable ? reorder.animatedStyleForRow(row.id) : undefined} onLayout={movable ? onLayout : undefined}>
            <View style={styles.row}>
                {movable ? (
                    <GestureDetector gesture={reorder.gestureForRow(row.id, props.index)!}>
                        <Pressable
                            testID={`home-layout.${row.id}.grip`}
                            accessibilityRole="adjustable"
                            accessibilityLabel={t('homeIndex.reorderHandle', { section: title })}
                            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                            onAccessibilityAction={(event) => {
                                if (event.nativeEvent.actionName === 'decrement' && props.index > 0) move(-1);
                                if (event.nativeEvent.actionName === 'increment' && props.index < last) move(1);
                            }}
                            // ⌥↑ / ⌥↓ move the focused section, the keyboard's drag.
                            {...(Platform.OS === 'web' ? {
                                onKeyDown: (event: { altKey?: boolean; key?: string; preventDefault?: () => void }) => {
                                    if (!event.altKey) return;
                                    if (event.key === 'ArrowUp' && props.index > 0) { event.preventDefault?.(); move(-1); }
                                    if (event.key === 'ArrowDown' && props.index < last) { event.preventDefault?.(); move(1); }
                                },
                            } : {})}
                            hitSlop={8}
                            style={styles.grip}
                        >
                            <Icon name="dots-six-vertical" size={14} color={theme.colors.text.tertiary} />
                        </Pressable>
                    </GestureDetector>
                ) : (
                    <View style={styles.grip} />
                )}
                <View style={styles.item}>
                    <Item
                        testID={`home-layout.${row.id}`}
                        title={title}
                        subtitle={rowSubtitle(row)}
                        icon={<Icon name={rowIcon(row)} />}
                        showChevron={false}
                        showDivider={props.showDivider}
                        rightElement={alwaysShown ? (
                            <View style={styles.locked}>
                                <Icon name="lock" size={12} color={theme.colors.text.tertiary} />
                                <Text style={styles.lockedText}>{t('homeIndex.alwaysShown')}</Text>
                            </View>
                        ) : (
                            <Switch
                                testID={`home-layout.${row.id}.shown`}
                                accessibilityLabel={`${t('settingsOverview.homeShowSection')}: ${title}`}
                                value={shown}
                                onValueChange={(next) => layout.setHidden(row.id, !next)}
                            />
                        )}
                    />
                </View>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create((theme) => ({
    popoverHeader: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
        gap: 4,
    },
    popoverTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    popoverTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
        fontSize: 15,
        lineHeight: 20,
    },
    popoverDescription: {
        color: theme.colors.text.secondary,
        fontSize: 13,
        lineHeight: 18,
    },
    rows: {
        position: 'relative',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    grip: {
        width: 20,
        alignSelf: 'stretch',
        alignItems: 'center',
        justifyContent: 'center',
    },
    item: {
        flex: 1,
        minWidth: 0,
    },
    locked: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    lockedText: {
        color: theme.colors.text.tertiary,
        fontSize: 12,
        lineHeight: 16,
    },
    overlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
    },
}));
