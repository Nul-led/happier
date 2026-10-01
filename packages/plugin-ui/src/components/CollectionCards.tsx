import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { I18nManager, ScrollView, View } from 'react-native';

import {
  resolveHappierUiPalette,
  useHappierUiAccessibility,
  useHappierUiTheme,
  useOptionalHappierUiLocalization,
  useOptionalHappierUiPalette,
  useOptionalHappierUiTypography,
} from '../environment/context.js';
import type { HappierTypeRole } from '../environment/types.js';
import type { HappierCollectionKey, HappierCollectionSection } from '../presentation/collection/collectionModel.js';
import { resolveHappierCollectionGridGeometry } from '../presentation/collection/collectionTable.js';
import type { HappierCollectionModel } from '../presentation/collection/useCollection.js';
import { HappierSkeletonBlock } from '../presentation/feedback/Skeleton.js';
import { HappierSegmentedChoice } from '../presentation/form/SegmentedChoice.js';
import { HappierPressable } from '../presentation/interaction/Pressable.js';
import { HAPPIER_PAGE_METRICS } from '../presentation/layout/pageMetrics.js';
import type { HappierFocusable, HappierPortableStyle, HappierStyleProp } from '../presentation/portableTypes.js';
import { HappierText } from '../presentation/text/Text.js';
import { resolveHappierTypeRoleStyle } from '../presentation/text/typeRole.js';
import { scaleTextStyleMetrics } from '../presentation/text/textStyleScale.js';
import type { CollectionAnatomy, CollectionGroupAction } from './Collection.js';
import { List } from './List.js';
import { ListCollectionControlContext, type ListCollectionControl } from './listCollectionControl.js';
import { usePluginTranslation } from './PluginUiProvider.js';

/**
 * The Collection's card presentations (COLLECTION.md §3, §6, §10.1): `board` draws one column of cards per group of
 * the one axis, and `grid` draws cards in responsive columns under optional shelves. Both draw the caller's one item
 * anatomy; consumers never write a card renderer. Opening a card goes through the model to the Collection's one
 * detail (the host details pane beside the cards, or the pushed page).
 */

type Theme = ReturnType<typeof useHappierUiTheme>;
type Typography = ReturnType<typeof useOptionalHappierUiTypography>;

/** One role's exact line height at the reader's text size: the Collection's geometry is arithmetic over these. */
export function readCollectionLineHeight(role: HappierTypeRole, theme: Theme, typography: Typography, textScale: number): number {
  const style = scaleTextStyleMetrics(resolveHappierTypeRoleStyle(role, theme, typography), textScale) as HappierPortableStyle;
  const value = (style as Readonly<{ lineHeight?: unknown }>).lineHeight;
  return typeof value === 'number' ? Math.ceil(value) : 20;
}

/** Card geometry at normal text size. Gutters and the card's radius come from the page metrics owner. */
const CARD = Object.freeze({
  padding: 14,
  markSize: 32,
  gap: 10,
  footerHeight: 28,
  boardColumnMinWidth: 260,
  boardCardInsetX: 10,
  boardCardInsetY: 4,
  /** The default narrowest grid card; one column at a 390 pt phone. */
  gridMinCardWidth: 280,
});
const GUTTER = HAPPIER_PAGE_METRICS.sheetInsetPx;
const RADIUS = HAPPIER_PAGE_METRICS.sheetRadiusPx;

export type CollectionCardsProps<Item> = Readonly<{
  presentation: 'board' | 'grid';
  model: HappierCollectionModel<Item>;
  anatomy: CollectionAnatomy<Item>;
  accessibilityLabel: string;
  /** The measured width the cards lay out in; `null` before the first measurement. */
  width: number | null;
  /** Both panes do not fit: the board pages its columns (a phone). */
  narrow: boolean;
  /** The item whose detail is on screen, marked selected. */
  selectedKey: HappierCollectionKey | null;
  /** Move focus to this card (a new object is a new request), e.g. after its detail closes. */
  focusRequest: Readonly<{ key: HappierCollectionKey }> | null;
  onFocusedKeyChange: (key: HappierCollectionKey) => void;
  /** The grid's narrowest card. */
  minCardWidth?: number;
  /** A shelf's one header action, by group key. */
  groupAction?: (groupKey: string) => CollectionGroupAction | null;
  /** Items are still arriving: the grid holds its geometry with skeleton cards. */
  loading?: boolean;
  empty?: ReactNode;
  /** The grid scrolls with the page around it (the Collection's `scroll="page"`): it draws no scroller of its own. */
  pageScroll?: boolean;
  testID?: string;
}>;

type CardText = Readonly<{ title: number; caption: number; label: number }>;

function useCardText(): CardText {
  const theme = useHappierUiTheme();
  const typography = useOptionalHappierUiTypography();
  const { textScale } = useHappierUiAccessibility();
  return useMemo(() => ({
    title: readCollectionLineHeight('body', theme, typography, textScale),
    caption: readCollectionLineHeight('caption', theme, typography, textScale),
    label: readCollectionLineHeight('label', theme, typography, textScale),
  }), [textScale, theme, typography]);
}

function useCardColors() {
  const theme = useHappierUiTheme();
  const palette = useOptionalHappierUiPalette(theme) ?? resolveHappierUiPalette(theme);
  return { theme, palette };
}

function Slot(props: Readonly<{ value: ReactNode; tone?: 'secondary' | 'muted' }>): ReactElement | null {
  const value = props.value;
  if (value === null || value === undefined || value === false) return null;
  if (typeof value === 'string' || typeof value === 'number') {
    return (
      <HappierText variant="caption" tone={props.tone ?? 'secondary'} numberOfLines={1} tabularNumbers style={shrinkStyle}>
        {String(value)}
      </HappierText>
    );
  }
  return <>{value}</>;
}

/** The ring that marks the card whose detail is open: drawn over the edge, so the card never changes size. */
function SelectedRing(props: Readonly<{ color: string; testID?: string }>): ReactElement {
  return <View pointerEvents="none" testID={props.testID} style={[ringStyle, { borderColor: props.color }]} />;
}

function useRtl(): boolean {
  const localization = useOptionalHappierUiLocalization();
  return localization ? localization.direction === 'rtl' : I18nManager.isRTL;
}

// ---------------------------------------------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------------------------------------------

function BoardCard<Item>(props: Readonly<{ item: Item; anatomy: CollectionAnatomy<Item>; selected: boolean }>): ReactElement {
  const { item, anatomy } = props;
  const { theme, palette } = useCardColors();
  const where = anatomy.where?.(item);
  const age = anatomy.age?.(item) ?? null;
  const reason = anatomy.reason?.(item);
  const signal = anatomy.signal?.(item);
  const agent = anatomy.agent?.(item);
  const hasFacts = (reason !== null && reason !== undefined) || (signal !== null && signal !== undefined);
  const hasAgent = agent !== null && agent !== undefined;
  return (
    <View style={[boardCardStyle, { backgroundColor: palette.sheet, borderColor: palette.sheetBorder }]}>
      <View style={boardCardBodyStyle}>
        <View style={lineStyle}>
          <View style={markStyle}>{anatomy.glyph(item)}</View>
          <HappierText variant="body" tone="neutral" numberOfLines={2} style={[titleStyle, shrinkStyle]}>{anatomy.title(item)}</HappierText>
        </View>
        {where === undefined && age === null ? null : (
          <View style={lineStyle}>
            <View style={[lineStyle, shrinkStyle]}><Slot value={where} /></View>
            {age === null ? null : <HappierText variant="caption" tone="muted" numberOfLines={1} tabularNumbers>{age}</HappierText>}
          </View>
        )}
        {!hasFacts ? null : (
          <View style={[lineStyle, { flexWrap: 'wrap' }]}>
            <Slot value={reason} />
            <Slot value={signal} />
          </View>
        )}
      </View>
      {!hasAgent ? null : (
        <View style={[agentStripStyle, { borderTopColor: theme.colors.divider }]}>
          <Slot value={agent} />
        </View>
      )}
      {props.selected ? <SelectedRing color={palette.selection} /> : null}
    </View>
  );
}

function BoardColumn<Item>(props: Readonly<{
  section: HappierCollectionSection<Item>;
  columnKey: string;
  model: HappierCollectionModel<Item>;
  anatomy: CollectionAnatomy<Item>;
  label: string;
  selectedKey: HappierCollectionKey | null;
  focusRequest: Readonly<{ key: string }> | undefined;
  onFocusedKeyChange: (key: HappierCollectionKey) => void;
  /** ← / → leave the column: the board moves focus to the neighbouring one. */
  onCrossColumn: (fromKey: HappierCollectionKey, direction: -1 | 1) => boolean;
  style: HappierStyleProp;
  showHeader: boolean;
  testID?: string;
}>): ReactElement {
  const { section, model, anatomy, selectedKey } = props;
  const rtl = useRtl();
  const keyOf = model.keyOf;
  const open = model.actions.open;
  const selected = selectedKey !== null && section.items.some((item) => keyOf(item) === selectedKey) ? selectedKey : null;
  const renderItem = useCallback((item: Item) => {
    const key = keyOf(item);
    return (
      <List.Item
        density="compact"
        showDivider={false}
        accessibilityLabel={anatomy.accessibilityLabel(item)}
        {...(anatomy.accessibilityHint?.(item) === undefined ? {} : { accessibilityHint: anatomy.accessibilityHint(item) })}
        {...(anatomy.testID === undefined ? {} : { testID: anatomy.testID(item) })}
        style={boardItemStyle}
      >
        <BoardCard item={item} anatomy={anatomy} selected={key === selected} />
      </List.Item>
    );
  }, [anatomy, keyOf, selected]);
  const onCrossColumn = props.onCrossColumn;
  const control = useMemo<ListCollectionControl>(() => ({
    onRowKey: (key, itemKey) => {
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return false;
      const forward = key === 'ArrowRight' ? !rtl : rtl;
      return onCrossColumn(itemKey, forward ? 1 : -1);
    },
  }), [onCrossColumn, rtl]);
  const group = section.group;
  return (
    <View style={props.style} testID={props.testID}>
      {!props.showHeader || group === null || group.title === '' ? null : (
        <View style={columnHeaderStyle}>
          <View style={lineStyle}>
            <HappierText variant="label" tone="neutral" numberOfLines={1} style={[titleStyle, shrinkStyle]}>{group.title}</HappierText>
            <HappierText variant="caption" tone="muted" tabularNumbers>{String(section.items.length)}</HappierText>
          </View>
          {group.description === undefined ? null : (
            <HappierText variant="caption" tone="muted" numberOfLines={2}>{group.description}</HappierText>
          )}
        </View>
      )}
      <View style={fillStyle}>
        <ListCollectionControlContext.Provider value={control}>
          <List<Item>
            accessibilityLabel={props.label}
            accessibilityPattern="listbox"
            density="compact"
            contentContainerStyle={boardListContentStyle}
            items={section.items}
            keyForItem={keyOf}
            renderItem={renderItem}
            selection={{
              selectedKey: selected,
              onSelectedKeyChange: open,
              onFocusedKeyChange: props.onFocusedKeyChange,
              ...(props.focusRequest === undefined ? {} : { focusRequest: props.focusRequest }),
            }}
          />
        </ListCollectionControlContext.Provider>
      </View>
    </View>
  );
}

function CollectionBoard<Item>(props: CollectionCardsProps<Item>): ReactElement {
  const { model } = props;
  const { theme, palette } = useCardColors();
  const translate = usePluginTranslation();
  const { textScale } = useHappierUiAccessibility();
  const sections = model.sections;
  const columnKeys = useMemo(() => sections.map((section, index) => section.group?.key ?? `collection-${index}`), [sections]);
  const [requests, setRequests] = useState<Readonly<Record<string, Readonly<{ key: string }>>>>({});
  const [page, setPage] = useState<string | null>(null);
  const pageKey = page !== null && columnKeys.includes(page) ? page : columnKeys[0] ?? null;

  const columnOf = useCallback((key: HappierCollectionKey): number => (
    sections.findIndex((section) => section.items.some((item) => model.keyOf(item) === key))
  ), [model, sections]);
  const requestFocus = useCallback((column: number, key: HappierCollectionKey) => {
    const columnKey = columnKeys[column];
    if (columnKey === undefined) return;
    setPage(columnKey);
    setRequests((current) => ({ ...current, [columnKey]: { key } }));
  }, [columnKeys]);

  // Focus returns to the card that opened a detail once it closes.
  const focusRequest = props.focusRequest;
  useEffect(() => {
    if (focusRequest === null) return;
    const column = columnOf(focusRequest.key);
    if (column >= 0) requestFocus(column, focusRequest.key);
    // Only a new request moves focus; a re-derived column index does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // A request is one move: the column's List claims it in this commit, so it is withdrawn right after. Left in
  // place, the List would re-run it whenever that column's cards change and take focus from wherever the reader is.
  useEffect(() => {
    if (Object.keys(requests).length > 0) setRequests({});
  }, [requests]);

  const onCrossColumn = useCallback((fromKey: HappierCollectionKey, direction: -1 | 1): boolean => {
    const from = columnOf(fromKey);
    if (from < 0) return false;
    const fromSection = sections[from]!;
    const row = fromSection.items.findIndex((item) => model.keyOf(item) === fromKey);
    for (let column = from + direction; column >= 0 && column < sections.length; column += direction) {
      const items = sections[column]!.items;
      if (items.length === 0) continue;
      requestFocus(column, model.keyOf(items[Math.min(row, items.length - 1)]!));
      return true;
    }
    return true;
  }, [columnOf, model, requestFocus, sections]);

  if (model.keys.length === 0 && props.empty !== undefined) return <View style={fillStyle}>{props.empty}</View>;

  const columnFor = (section: HappierCollectionSection<Item>, index: number, style: HappierStyleProp, showHeader: boolean) => {
    const columnKey = columnKeys[index]!;
    return (
      <BoardColumn
        key={columnKey}
        section={section}
        columnKey={columnKey}
        model={model}
        anatomy={props.anatomy}
        label={section.group?.title || props.accessibilityLabel}
        selectedKey={props.selectedKey}
        focusRequest={requests[columnKey]}
        onFocusedKeyChange={props.onFocusedKeyChange}
        onCrossColumn={onCrossColumn}
        style={style}
        showHeader={showHeader}
        {...(props.testID === undefined ? {} : { testID: `${props.testID}:column:${columnKey}` })}
      />
    );
  };

  if (props.narrow) {
    // A phone pages the columns: one column at a time, chosen by name and count.
    const index = pageKey === null ? -1 : columnKeys.indexOf(pageKey);
    const section = index < 0 ? undefined : sections[index];
    return (
      <View style={fillStyle}>
        {sections.length < 2 ? null : (
          <View style={pagerStyle}>
            <HappierSegmentedChoice
              accessibilityLabel={translate('happier.plugin-ui.collection.board.columns', 'Columns')}
              segments={sections.map((candidate, candidateIndex) => ({
                key: columnKeys[candidateIndex]!,
                label: `${candidate.group?.title ?? ''} ${candidate.items.length}`,
                selected: candidateIndex === index,
                disabled: false,
              }))}
              onSelect={(next) => { setPage(columnKeys[next] ?? null); }}
              colors={{
                track: palette.segmentTrack,
                thumb: palette.segmentThumb,
                label: theme.colors.secondaryText,
                activeLabel: theme.colors.text,
                focusRing: theme.colors.focus,
              }}
              {...(props.testID === undefined ? {} : { testID: `${props.testID}:pager` })}
            />
          </View>
        )}
        {section === undefined ? null : columnFor(section, index, fillStyle, sections.length < 2)}
      </View>
    );
  }

  const minColumn = CARD.boardColumnMinWidth * textScale;
  const fits = props.width === null || sections.length * minColumn <= props.width;
  const columns = sections.map((section, index) => columnFor(section, index, [
    fits ? fillStyle : { width: minColumn },
    index < sections.length - 1 ? { borderRightWidth: 1, borderRightColor: theme.colors.divider } : null,
  ], true));
  return fits ? (
    <View style={boardRowStyle}>{columns}</View>
  ) : (
    <ScrollView horizontal style={fillStyle} contentContainerStyle={boardRowScrollStyle}>{columns}</ScrollView>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------------------------------------------

type GridGeometry = Readonly<{
  columns: number;
  cardWidth: number;
  cardHeight: number;
  /** Zero when no card in the grid has a description: the grid keeps no empty lines. */
  descriptionHeight: number;
  /** False when no card in the grid has a status or an action: the grid keeps no empty footer. */
  footer: boolean;
}>;

/** Which of a card's optional slots this grid keeps: those at least one of its cards fills (every card keeps them). */
type GridSlots = Readonly<{ description: boolean; footer: boolean }>;

function present(value: ReactNode): boolean {
  return value !== null && value !== undefined && value !== false;
}

function useGridSlots<Item>(model: HappierCollectionModel<Item>, anatomy: CollectionAnatomy<Item>): GridSlots {
  return useMemo(() => {
    const items = model.sections.flatMap((section) => section.items);
    if (items.length === 0) {
      // Nothing to read yet (loading): hold the anatomy's declared shape, so the skeleton matches what arrives.
      return {
        description: anatomy.description !== undefined,
        footer: anatomy.reason !== undefined || anatomy.action !== undefined,
      };
    }
    let description = false;
    let footer = false;
    for (const item of items) {
      if (!description && (anatomy.description?.(item) ?? null) !== null) description = true;
      if (!footer && (present(anatomy.reason?.(item)) || present(anatomy.action?.(item)))) footer = true;
      if (description && footer) break;
    }
    return { description, footer };
  }, [anatomy, model.sections]);
}

function useGridGeometry(width: number | null, minCardWidth: number, slots: GridSlots): GridGeometry {
  const text = useCardText();
  const { textScale } = useHappierUiAccessibility();
  return useMemo(() => {
    const inner = Math.max(0, (width ?? 0) - 2 * GUTTER);
    const { columns, cardWidth } = resolveHappierCollectionGridGeometry({ width: inner, minCardWidth: minCardWidth * textScale, gap: GUTTER });
    const descriptionHeight = slots.description ? 2 * text.caption : 0;
    // Exact per text size, never measured per card: every card is the same height, so rows are equal and footers align.
    const head = Math.max(CARD.markSize, text.title + text.caption);
    const cardHeight = 2 + 2 * CARD.padding + head
      + (slots.description ? CARD.gap + descriptionHeight : 0)
      + (slots.footer ? CARD.gap + CARD.footerHeight : 0);
    return { columns, cardWidth, cardHeight, descriptionHeight, footer: slots.footer };
  }, [minCardWidth, slots, text, textScale, width]);
}

function GridCard<Item>(props: Readonly<{
  item: Item;
  itemKey: string;
  anatomy: CollectionAnatomy<Item>;
  geometry: GridGeometry;
  selected: boolean;
  tabStop: boolean;
  onOpen: (key: string) => void;
  onFocus: (key: string) => void;
  onKey: (key: string, from: string) => boolean;
  register: (key: string, target: HappierFocusable | null) => void;
}>): ReactElement {
  const { item, itemKey, anatomy, geometry } = props;
  const { theme, palette } = useCardColors();
  const testID = anatomy.testID?.(item);
  const where = anatomy.where?.(item);
  const description = anatomy.description?.(item) ?? null;
  const status = anatomy.reason?.(item);
  const action = anatomy.action?.(item);
  const hasAction = action !== null && action !== undefined && action !== false;
  const register = props.register;
  const onKey = props.onKey;
  const onFocus = props.onFocus;
  return (
    <View
      style={[gridCardStyle, { width: geometry.cardWidth, height: geometry.cardHeight, backgroundColor: palette.sheet, borderColor: palette.sheetBorder }]}
      {...(testID === undefined ? {} : { testID: `${testID}:card` })}
    >
      <HappierPressable
        accessibilityRole="button"
        accessibilityLabel={anatomy.accessibilityLabel(item)}
        {...(anatomy.accessibilityHint?.(item) === undefined ? {} : { accessibilityHint: anatomy.accessibilityHint(item) })}
        selected={props.selected}
        tabIndex={props.tabStop ? 0 : -1}
        controlRef={(target) => { register(itemKey, target); }}
        onKeyDown={(key) => onKey(key, itemKey)}
        onFocusChange={(focused) => { if (focused) onFocus(itemKey); }}
        onPress={() => { props.onOpen(itemKey); }}
        {...(testID === undefined ? {} : { testID })}
        style={(state) => ({
          flex: 1,
          padding: CARD.padding,
          borderRadius: RADIUS - 1,
          borderWidth: 1,
          borderColor: state.focused ? theme.colors.focus : 'transparent',
          gap: CARD.gap,
        })}
      >
        <View style={[lineStyle, { alignItems: 'flex-start' }]}>
          <View style={[markStyle, { width: CARD.markSize, height: CARD.markSize }]}>{anatomy.glyph(item)}</View>
          <View style={shrinkStyle}>
            <HappierText variant="body" tone="neutral" numberOfLines={1} style={titleStyle}>{anatomy.title(item)}</HappierText>
            <Slot value={where} />
          </View>
        </View>
        {geometry.descriptionHeight === 0 ? null : (
        <View style={{ height: geometry.descriptionHeight }}>
          {description === null ? null : (
            <HappierText
              variant="caption"
              tone="secondary"
              numberOfLines={2}
              {...(testID === undefined ? {} : { testID: `${testID}:description` })}
            >
              {description}
            </HappierText>
          )}
        </View>
        )}
        {/* The footer's place: the status on the left; the action's room is kept on the right. */}
        {!geometry.footer ? null : (
          <View style={[lineStyle, { height: CARD.footerHeight }]}>
            <View style={[lineStyle, shrinkStyle]}><Slot value={status} /></View>
          </View>
        )}
      </HappierPressable>
      {!hasAction ? null : (
        // Its own target beside the card's, never inside it: pressing it acts and never opens the item.
        <View style={gridActionStyle}>{action}</View>
      )}
      {props.selected ? <SelectedRing color={palette.selection} {...(testID === undefined ? {} : { testID: `${testID}:selected` })} /> : null}
    </View>
  );
}

function CollectionGrid<Item>(props: CollectionCardsProps<Item>): ReactElement {
  const { model, anatomy } = props;
  const { theme } = useCardColors();
  const rtl = useRtl();
  const geometry = useGridGeometry(props.width, props.minCardWidth ?? CARD.gridMinCardWidth, useGridSlots(model, anatomy));
  const keyOf = model.keyOf;
  const keys = useMemo(() => model.sections.flatMap((section) => section.items.map(keyOf)), [keyOf, model.sections]);
  // The last known card count, which the skeleton holds while the items are arriving again.
  const lastKnownCount = useRef(0);
  if (keys.length > 0) lastKnownCount.current = keys.length;

  // ---- roving focus: one tab stop, arrows move across and down the grid ----
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const tabStopKey = focusKey !== null && keys.includes(focusKey) ? focusKey : keys[0] ?? null;
  const targets = useRef(new Map<string, HappierFocusable>());
  const register = useCallback((key: string, target: HappierFocusable | null) => {
    if (target === null) targets.current.delete(key);
    else targets.current.set(key, target);
  }, []);
  const authorFocus = props.onFocusedKeyChange;
  const onFocus = useCallback((key: string) => {
    setFocusKey(key);
    authorFocus(key);
  }, [authorFocus]);
  const focus = useCallback((key: string) => {
    setFocusKey(key);
    targets.current.get(key)?.focus();
  }, []);
  // Each card's place: shelves start new rows, so "down" is the next row, wherever it is.
  const places = useMemo(() => {
    const result = new Map<string, Readonly<{ row: number; column: number }>>();
    const rows: string[][] = [];
    for (const section of model.sections) {
      section.items.forEach((item, index) => {
        if (index % geometry.columns === 0) rows.push([]);
        const row = rows[rows.length - 1]!;
        result.set(keyOf(item), { row: rows.length - 1, column: row.length });
        row.push(keyOf(item));
      });
    }
    return { of: result, rows };
  }, [geometry.columns, keyOf, model.sections]);
  const onKey = useCallback((key: string, from: string): boolean => {
    const place = places.of.get(from);
    if (place === undefined) return false;
    const index = keys.indexOf(from);
    let next: string | undefined;
    if (key === 'ArrowRight' || key === 'ArrowLeft') next = keys[index + ((key === 'ArrowRight') !== rtl ? 1 : -1)];
    else if (key === 'ArrowDown' || key === 'ArrowUp') {
      const row = places.rows[place.row + (key === 'ArrowDown' ? 1 : -1)];
      next = row === undefined ? undefined : row[Math.min(place.column, row.length - 1)];
    } else if (key === 'Home') next = keys[0];
    else if (key === 'End') next = keys[keys.length - 1];
    else return false;
    if (next !== undefined) focus(next);
    return true;
  }, [focus, keys, places, rtl]);

  const focusRequest = props.focusRequest;
  useEffect(() => {
    if (focusRequest !== null) focus(focusRequest.key);
  }, [focus, focusRequest]);

  const inner = props.width === null ? null : props.width - 2 * GUTTER;
  if (props.loading === true && keys.length === 0) {
    const count = lastKnownCount.current > 0 ? lastKnownCount.current : geometry.columns;
    const rows: number[][] = [];
    for (let index = 0; index < count; index += 1) {
      if (index % geometry.columns === 0) rows.push([]);
      rows[rows.length - 1]!.push(index);
    }
    return (
      <GridScroller pageScroll={props.pageScroll === true}>
        {rows.map((row, rowIndex) => (
          <View key={rowIndex} style={gridRowStyle}>
            {row.map((index) => (
              <HappierSkeletonBlock
                key={index}
                color={theme.colors.control}
                width={geometry.cardWidth}
                height={geometry.cardHeight}
                radius={RADIUS}
                {...(props.testID === undefined ? {} : { testID: `${props.testID}:skeleton-card` })}
              />
            ))}
          </View>
        ))}
      </GridScroller>
    );
  }
  if (keys.length === 0 && props.empty !== undefined) return <View style={props.pageScroll === true ? null : fillStyle}>{props.empty}</View>;

  const selectedKey = props.selectedKey;
  const open = model.actions.open;
  return (
    <GridScroller pageScroll={props.pageScroll === true}>
      {inner === null ? null : model.sections.map((section, sectionIndex) => {
        const group = section.group;
        const shelf = group !== null && group.title !== '';
        const rows: Item[][] = [];
        section.items.forEach((item, index) => {
          if (index % geometry.columns === 0) rows.push([]);
          rows[rows.length - 1]!.push(item);
        });
        return (
          <View
            key={group?.key ?? `collection-${sectionIndex}`}
            role={shelf ? 'group' : undefined}
            aria-label={shelf ? group.title : undefined}
            style={shelfStyle}
            {...(props.testID === undefined || !shelf ? {} : { testID: `${props.testID}:shelf:${group.key}` })}
          >
            {!shelf ? null : (
              <View style={shelfHeaderStyle}>
                <View style={shrinkStyle}>
                  <HappierText variant="label" tone="neutral" numberOfLines={1} style={titleStyle}>{group.title}</HappierText>
                  {group.description === undefined ? null : (
                    <HappierText variant="caption" tone="muted" numberOfLines={1}>{group.description}</HappierText>
                  )}
                </View>
                <CollectionGroupActionButton
                  action={props.groupAction?.(group.key) ?? null}
                  groupKey={group.key}
                  groupTitle={group.title}
                  {...(props.testID === undefined ? {} : { testID: props.testID })}
                />
              </View>
            )}
            {rows.map((row, rowIndex) => (
              <View
                key={rowIndex}
                style={gridRowStyle}
                {...(props.testID === undefined ? {} : { testID: `${props.testID}:grid-row` })}
              >
                {row.map((item) => {
                  const key = keyOf(item);
                  return (
                    <GridCard
                      key={key}
                      item={item}
                      itemKey={key}
                      anatomy={anatomy}
                      geometry={geometry}
                      selected={key === selectedKey}
                      tabStop={key === tabStopKey}
                      onOpen={open}
                      onFocus={onFocus}
                      onKey={onKey}
                      register={register}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        );
      })}
    </GridScroller>
  );
}

/** The grid's own scroller, or, where the grid scrolls with its page, just its content box. */
function GridScroller(props: Readonly<{ pageScroll: boolean; children?: ReactNode }>): ReactElement {
  return props.pageScroll
    ? <View style={gridContentStyle}>{props.children}</View>
    : <ScrollView style={fillStyle} contentContainerStyle={gridContentStyle}>{props.children}</ScrollView>;
}

/** A group header's one action ("See all"), named with its group for assistive technology. */
export function CollectionGroupActionButton(props: Readonly<{
  action: CollectionGroupAction | null;
  groupKey: string;
  groupTitle: string;
  testID?: string;
}>): ReactElement | null {
  const action = props.action;
  if (action === null) return null;
  return (
    <HappierPressable
      accessibilityRole="button"
      accessibilityLabel={`${action.label}, ${props.groupTitle}`}
      onPress={action.onPress}
      {...(props.testID === undefined ? {} : { testID: `${props.testID}:group:${props.groupKey}:action` })}
      style={(state) => ({ opacity: state.pressed ? 0.6 : 1 })}
    >
      <HappierText variant="caption" tone="secondary">{action.label}</HappierText>
    </HappierPressable>
  );
}


export function CollectionCards<Item>(props: CollectionCardsProps<Item>): ReactElement {
  return props.presentation === 'board' ? <CollectionBoard {...props} /> : <CollectionGrid {...props} />;
}

const fillStyle: HappierPortableStyle = { flex: 1, minWidth: 0, minHeight: 0 };
const shrinkStyle: HappierPortableStyle = { flex: 1, minWidth: 0, flexShrink: 1 };
const lineStyle: HappierPortableStyle = { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 };
const titleStyle: HappierPortableStyle = { fontWeight: '600' };
const markStyle: HappierPortableStyle = { alignItems: 'center', justifyContent: 'center' };
const ringStyle: HappierPortableStyle = {
  position: 'absolute',
  top: -1,
  left: -1,
  right: -1,
  bottom: -1,
  borderWidth: 2,
  borderRadius: RADIUS + 1,
};
const boardRowStyle: HappierPortableStyle = { flex: 1, flexDirection: 'row', minWidth: 0, minHeight: 0 };
const boardRowScrollStyle: HappierPortableStyle = { flexGrow: 1, flexDirection: 'row' };
const boardListContentStyle: HappierPortableStyle = { gap: 0, paddingBottom: CARD.padding };
const boardItemStyle: HappierPortableStyle = { paddingHorizontal: CARD.boardCardInsetX, paddingVertical: CARD.boardCardInsetY };
const boardCardStyle: HappierPortableStyle = { borderWidth: 1, borderRadius: RADIUS, overflow: 'visible' };
const boardCardBodyStyle: HappierPortableStyle = { gap: 6, paddingHorizontal: 12, paddingTop: 11, paddingBottom: 12 };
const agentStripStyle: HappierPortableStyle = { borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center' };
const columnHeaderStyle: HappierPortableStyle = { gap: 2, paddingHorizontal: GUTTER, paddingTop: 14, paddingBottom: 10 };
const pagerStyle: HappierPortableStyle = { paddingHorizontal: GUTTER, paddingVertical: 10 };
const gridContentStyle: HappierPortableStyle = { padding: GUTTER, gap: HAPPIER_PAGE_METRICS.sectionGapPx };
const shelfStyle: HappierPortableStyle = { gap: GUTTER };
const shelfHeaderStyle: HappierPortableStyle = { flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: HAPPIER_PAGE_METRICS.headingOpticalInsetPx };
const gridRowStyle: HappierPortableStyle = { flexDirection: 'row', gap: GUTTER };
const gridCardStyle: HappierPortableStyle = { borderWidth: 1, borderRadius: RADIUS };
const gridActionStyle: HappierPortableStyle = {
  position: 'absolute',
  right: CARD.padding + 1,
  bottom: CARD.padding + 1,
  height: CARD.footerHeight,
  justifyContent: 'center',
};
