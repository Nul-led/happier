import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { HappierPressable, happierPageTextMetrics } from '@happier-dev/plugin-ui/presentation';

import { CompactSearchField } from '@/components/ui/forms/CompactSearchField';
import { Icon } from '@/components/ui/icons/Icon';
import { focusRingStyle } from '@/components/ui/interactions/interactionFeedback';
import { ActionListSection, type ActionListItem } from '@/components/ui/lists/ActionListSection';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import {
    filterWidgetAddSections,
    matchesWidgetAddAsk,
    type WidgetAddAsk,
    type WidgetAddEntry,
    type WidgetAddSection,
    type WidgetAddView,
} from './widgetAddModel';

/** The preview box keeps one height, so a tile never resizes while its widget loads. */
const PREVIEW_HEIGHT_PX = 96;
const BLANK_PREVIEW_HEIGHT_PX = 64;
/** The live body is drawn a step smaller, so a widget's first rows read inside the tile. */
const PREVIEW_SCALE = 0.86;

export type WidgetAddPanelProps = Readonly<{
    title: string;
    /** Who sees what you add ("Everyone here sees what you add"). */
    hint?: string;
    searchPlaceholder: string;
    view: WidgetAddView;
    onViewChange: (view: WidgetAddView) => void;
    sections: readonly WidgetAddSection[];
    ask?: WidgetAddAsk;
    /** Phones: the switch takes its own full-width row under the title, and Done closes. */
    phone?: boolean;
    onRequestClose: () => void;
    testID: string;
}>;

/**
 * The one Add surface for widgets (lab `cwidgets` G1, round 2): a title with who sees what you add,
 * a Gallery | List switch (the Collection's view switch), search, then the placement's sections.
 *
 * Gallery shows widgets as they are — a tile per widget with its real body at this placement's
 * data — because widgets are visual. List is the same sections, search and Added rows as menu rows,
 * denser, and mounts no preview. The panel owns no data and no write path: each pick goes to the
 * entry's own `onPick` (the placement's existing add path), and the panel stays open for another
 * unless the pick hands the focus somewhere else.
 */
export function WidgetAddPanel(props: WidgetAddPanelProps): React.ReactElement {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const [query, setQuery] = React.useState('');
    const sections = React.useMemo(() => filterWidgetAddSections(props.sections, query), [props.sections, query]);
    const ask = props.ask && matchesWidgetAddAsk(props.ask, query) ? props.ask : null;
    const close = props.onRequestClose;
    const pick = React.useCallback((entry: WidgetAddEntry) => {
        if (entry.added) return;
        entry.onPick();
        if (entry.closesOnPick) close();
    }, [close]);
    const pickAsk = React.useCallback(() => {
        props.ask?.onPick();
        close();
    }, [close, props.ask]);

    const tabs = React.useMemo(() => [
        { id: 'gallery' as const, label: t('widgetAdd.viewGallery') },
        { id: 'list' as const, label: t('widgetAdd.viewList') },
    ], []);
    const switcher = (
        <SegmentedTabBar
            tabs={tabs}
            activeTabId={props.view}
            onSelectTab={props.onViewChange}
            testIDPrefix={`${props.testID}.view`}
            accessibilityLabel={t('widgetAdd.viewLabel')}
            segmentSizing={props.phone ? 'equal' : 'content'}
            slidingThumb
            targetSize="platform"
        />
    );
    const nothing = sections.length === 0 && !ask;

    return (
        <View testID={props.testID} accessibilityLabel={props.title} style={styles.root}>
            <View style={styles.header}>
                <View style={styles.titleBlock}>
                    <Text style={[styles.title, props.phone ? styles.titlePhone : null]} accessibilityRole="header" numberOfLines={1}>
                        {props.title}
                    </Text>
                    {props.hint && !props.phone ? <Text style={styles.hint} numberOfLines={1}>{props.hint}</Text> : null}
                </View>
                {props.phone ? (
                    <HappierPressable
                        testID={`${props.testID}.done`}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.done')}
                        onPress={close}
                        style={(state) => [styles.done, focusRingStyle({ focused: state.focused, color: theme.colors.border.focus })]}
                    >
                        <Text style={styles.doneLabel}>{t('common.done')}</Text>
                    </HappierPressable>
                ) : switcher}
            </View>
            {props.phone ? <View style={styles.switchRow}>{switcher}</View> : null}
            <CompactSearchField
                value={query}
                onChangeText={setQuery}
                placeholder={props.searchPlaceholder}
                testID={`${props.testID}.search`}
                style={styles.search}
                {...(Platform.OS === 'web' && !props.phone ? { autoFocus: true } : {})}
            />
            {props.view === 'gallery' ? (
                <>
                    {sections.map((section) => (
                        <GallerySection key={section.id} section={section} phone={props.phone === true} onPick={pick} testID={props.testID} />
                    ))}
                    {ask ? <AskTile ask={ask} onPick={pickAsk} testID={`${props.testID}.ask`} /> : null}
                </>
            ) : (
                <>
                    {sections.map((section, index) => (
                        <ActionListSection
                            key={section.id}
                            title={section.title}
                            separatorAbove={index > 0}
                            actions={section.entries.map((entry) => listRow(entry, pick, props.testID, theme.colors.text))}
                        />
                    ))}
                    {ask ? (
                        <ActionListSection
                            separatorAbove={sections.length > 0}
                            actions={[{
                                id: 'ask',
                                testID: `${props.testID}.ask`,
                                label: ask.title,
                                subtitle: ask.note,
                                icon: <Icon name="sparkle" size={18} color={theme.colors.text.secondary} />,
                                onPress: pickAsk,
                            }]}
                        />
                    ) : null}
                </>
            )}
            {nothing ? (
                <Text style={styles.empty} testID={`${props.testID}.noMatch`}>
                    {t('widgetAdd.noMatch', { query: query.trim() })}
                </Text>
            ) : null}
        </View>
    );
}

function listRow(
    entry: WidgetAddEntry,
    pick: (entry: WidgetAddEntry) => void,
    testID: string,
    text: Readonly<{ secondary: string; tertiary: string }>,
): ActionListItem {
    return {
        id: entry.id,
        testID: `${testID}.entry.${entry.id}`,
        label: entry.title,
        ...(entry.subtitle ? { subtitle: entry.subtitle } : {}),
        icon: <Icon name={entry.icon} size={18} color={entry.added ? text.tertiary : text.secondary} />,
        ...(entry.added
            ? { right: <AddedMark />, disabled: true }
            : { onPress: () => pick(entry) }),
    };
}

function AddedMark(): React.ReactElement {
    const { theme } = useUnistyles();
    return (
        <View style={stylesheet.added}>
            <Icon name="check" size={12} color={theme.colors.text.tertiary} />
            <Text style={stylesheet.addedText}>{t('widgetAdd.added')}</Text>
        </View>
    );
}

function GallerySection(props: Readonly<{
    section: WidgetAddSection;
    phone: boolean;
    onPick: (entry: WidgetAddEntry) => void;
    testID: string;
}>): React.ReactElement {
    const styles = stylesheet;
    const { section } = props;
    // Glyph tiles carry no preview, so three share a row on wide surfaces.
    const columns = section.kind === 'make' && !props.phone ? 3 : 2;
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle} accessibilityRole="header">{section.title}</Text>
                <View style={styles.grow} />
                {section.hint ? <Text style={styles.sectionHint} numberOfLines={1}>{section.hint}</Text> : null}
            </View>
            {section.kind === 'chips' ? (
                <View style={styles.chips}>
                    {section.entries.map((entry) => (
                        <PaneChip key={entry.id} entry={entry} onPick={props.onPick} testID={`${props.testID}.entry.${entry.id}`} />
                    ))}
                </View>
            ) : (
                <View style={styles.tiles}>
                    {section.entries.map((entry) => (
                        <View key={entry.id} style={{ width: `${100 / columns}%` as const, padding: 4 }}>
                            <Tile entry={entry} onPick={props.onPick} testID={`${props.testID}.entry.${entry.id}`} />
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}

function Tile(props: Readonly<{ entry: WidgetAddEntry; onPick: (entry: WidgetAddEntry) => void; testID: string }>): React.ReactElement {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { entry } = props;
    const preview = entry.renderPreview;
    return (
        <HappierPressable
            testID={props.testID}
            accessibilityRole="button"
            accessibilityLabel={[entry.title, entry.subtitle, entry.added ? t('widgetAdd.added') : null].filter(Boolean).join(', ')}
            disabled={entry.added === true}
            onPress={() => props.onPick(entry)}
            style={(state) => [
                styles.tile,
                state.hovered || state.pressed ? styles.tileActive : null,
                focusRingStyle({ focused: state.focused, color: theme.colors.border.focus }),
            ]}
        >
            {preview ? (
                <View style={[styles.preview, entry.added ? styles.previewAdded : null]} pointerEvents="none">
                    <View style={styles.previewScale}>{preview()}</View>
                </View>
            ) : (
                <View style={[styles.preview, styles.previewBlank]} pointerEvents="none">
                    <Icon name={entry.icon} size={22} color={theme.colors.text.tertiary} />
                </View>
            )}
            <View style={styles.label}>
                <Icon name={entry.icon} size={14} color={theme.colors.text.secondary} />
                <View style={styles.labelText}>
                    <Text style={styles.tileTitle} numberOfLines={1}>{entry.title}</Text>
                    {entry.subtitle ? <Text style={styles.tileSubtitle} numberOfLines={1}>{entry.subtitle}</Text> : null}
                </View>
                {entry.added ? <AddedMark /> : null}
            </View>
        </HappierPressable>
    );
}

function PaneChip(props: Readonly<{ entry: WidgetAddEntry; onPick: (entry: WidgetAddEntry) => void; testID: string }>): React.ReactElement {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const { entry } = props;
    return (
        <HappierPressable
            testID={props.testID}
            accessibilityRole="button"
            accessibilityLabel={entry.added ? `${entry.title}, ${t('widgetAdd.added')}` : entry.title}
            disabled={entry.added === true}
            onPress={() => props.onPick(entry)}
            style={(state) => [
                styles.chip,
                entry.added ? styles.chipAdded : null,
                state.pressed ? styles.tileActive : null,
                focusRingStyle({ focused: state.focused, color: theme.colors.border.focus }),
            ]}
        >
            <Icon name={entry.icon} size={14} color={theme.colors.text.secondary} />
            <Text style={[styles.chipLabel, entry.added ? styles.chipLabelAdded : null]}>{entry.title}</Text>
            {entry.added ? <Icon name="check" size={12} color={theme.colors.text.tertiary} /> : null}
        </HappierPressable>
    );
}

function AskTile(props: Readonly<{ ask: WidgetAddAsk; onPick: () => void; testID: string }>): React.ReactElement {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    return (
        <View style={styles.askWrap}>
            <HappierPressable
                testID={props.testID}
                accessibilityRole="button"
                accessibilityLabel={`${props.ask.title}. ${props.ask.note}`}
                onPress={props.onPick}
                style={(state) => [
                    styles.ask,
                    state.hovered || state.pressed ? styles.tileActive : null,
                    focusRingStyle({ focused: state.focused, color: theme.colors.border.focus }),
                ]}
            >
                <Icon name="sparkle" size={16} color={theme.colors.text.secondary} />
                <View style={styles.askBody}>
                    <Text style={styles.tileTitle}>{props.ask.title}</Text>
                    <View style={styles.askDraft}>
                        <Text style={styles.askDraftText} numberOfLines={1}>
                            {props.ask.draft}
                            <Text style={styles.askDraftEllipsis}>…</Text>
                        </Text>
                    </View>
                    <Text style={styles.tileSubtitle}>{props.ask.note}</Text>
                </View>
            </HappierPressable>
        </View>
    );
}


const stylesheet = StyleSheet.create((theme) => ({
    root: { paddingHorizontal: 6, paddingTop: 6, paddingBottom: 6 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingTop: 4, paddingBottom: 8 },
    titleBlock: { flex: 1, minWidth: 0, gap: 1 },
    title: { ...Typography.default('semiBold'), ...happierPageTextMetrics('sectionTitle'), color: theme.colors.text.primary },
    titlePhone: { ...happierPageTextMetrics('rowTitle'), fontSize: 17, lineHeight: 22 },
    hint: { ...Typography.default(), fontSize: 12, lineHeight: 16, color: theme.colors.text.tertiary },
    done: { paddingHorizontal: 6, paddingVertical: 8, borderRadius: 8 },
    doneLabel: { ...Typography.default('semiBold'), ...happierPageTextMetrics('rowTitle'), color: theme.colors.text.link },
    switchRow: { paddingHorizontal: 2, paddingBottom: 10 },
    search: { marginHorizontal: 4, marginBottom: 4 },
    section: { paddingTop: 6, paddingBottom: 2 },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4 },
    sectionTitle: { ...Typography.default('semiBold'), fontSize: 12, lineHeight: 16, color: theme.colors.text.secondary },
    sectionHint: { ...Typography.default(), fontSize: 12, lineHeight: 16, color: theme.colors.text.tertiary, flexShrink: 1 },
    grow: { flex: 1 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap' },
    tile: { borderRadius: 12, padding: 6, gap: 6 },
    tileActive: { backgroundColor: theme.colors.surface.pressed },
    preview: {
        height: PREVIEW_HEIGHT_PX,
        borderRadius: 9,
        overflow: 'hidden',
        backgroundColor: theme.colors.surface.base,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        paddingVertical: 8,
        paddingHorizontal: 10,
    },
    previewScale: {
        width: `${100 / PREVIEW_SCALE}%` as const,
        transform: [{ scale: PREVIEW_SCALE }],
        transformOrigin: 'top left',
    },
    previewAdded: { opacity: 0.55 },
    previewBlank: { height: BLANK_PREVIEW_HEIGHT_PX, alignItems: 'center', justifyContent: 'center' },
    label: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 2 },
    labelText: { flex: 1, minWidth: 0 },
    tileTitle: { ...Typography.default('semiBold'), fontSize: 12.5, lineHeight: 17, color: theme.colors.text.primary },
    tileSubtitle: { ...Typography.default(), fontSize: 11.5, lineHeight: 15, color: theme.colors.text.tertiary },
    added: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    addedText: { ...Typography.default(), fontSize: 11.5, color: theme.colors.text.tertiary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 6, paddingBottom: 4 },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 30,
        paddingLeft: 9,
        paddingRight: 11,
        borderRadius: 15,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
    },
    chipAdded: { backgroundColor: theme.colors.surface.selected, borderColor: 'transparent' },
    chipLabel: { ...Typography.default(), fontSize: 12.5, color: theme.colors.text.primary },
    chipLabelAdded: { color: theme.colors.text.secondary },
    askWrap: { paddingHorizontal: 4, paddingTop: 4, paddingBottom: 2 },
    ask: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 12,
        backgroundColor: theme.colors.surface.inset,
    },
    askBody: { flex: 1, minWidth: 0, gap: 4 },
    askDraft: {
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.base,
        paddingVertical: 6,
        paddingHorizontal: 9,
    },
    askDraftText: { ...Typography.default(), fontSize: 13, lineHeight: 18, color: theme.colors.text.primary },
    askDraftEllipsis: { color: theme.colors.text.tertiary },
    empty: { ...Typography.default(), fontSize: 13, color: theme.colors.text.secondary, paddingHorizontal: 10, paddingVertical: 10 },
}));
