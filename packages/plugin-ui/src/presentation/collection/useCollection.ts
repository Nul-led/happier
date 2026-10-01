import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { I18nManager } from 'react-native';

import { useOptionalHappierUiLocalization } from '../../environment/context.js';
import {
  HAPPIER_COLLECTION_WINDOW_COMPLETE,
  deriveHappierCollectionSections,
  resolveHappierCollectionInitialKey,
  resolveHappierCollectionKeyCommand,
  type HappierCollectionDraftTitleStore,
  type HappierCollectionGrouping,
  type HappierCollectionKey,
  type HappierCollectionSection,
  type HappierCollectionVisitMemory,
  type HappierCollectionWindow,
} from './collectionModel.js';
import { useHappierCollectionLayout, type HappierCollectionLayoutState } from './collectionLayout.js';
import {
  HAPPIER_LIST_MULTI_SELECTION_INERT_SNAPSHOT,
  createHappierListMultiSelectionStore,
  type HappierListMultiSelectionSnapshot,
  type HappierListMultiSelectionStore,
} from './multiSelection.js';

/** A draft being added: a key that is not a persisted id, titled from the draft store. */
export type HappierCollectionDraftInput = Readonly<{
  key: HappierCollectionKey;
  /** Shown until the editor publishes a name ("New ACP agent"). */
  placeholder: string;
  titles: HappierCollectionDraftTitleStore;
}>;

export type HappierCollectionDraft = HappierCollectionDraftInput & Readonly<{ open: boolean }>;

export type HappierCollectionModelInput<Item> = Readonly<{
  items: readonly Item[];
  /** Stable identity, mandatory. */
  keyOf: (item: Item) => HappierCollectionKey;
  groups?: HappierCollectionGrouping<Item>;
  order?: (left: Item, right: Item) => number;
  filter?: (item: Item) => boolean;
  window?: HappierCollectionWindow;
  /** `multiple` is the existing multi-selection reducer and store, unchanged. */
  selection?: 'none' | 'single' | 'multiple';
  /** Controlled by the caller's route; the model never pushes history. */
  openKey: HappierCollectionKey | null;
  /** The caller navigates; a new `openKey` is the answer. */
  onOpenChange: (key: HappierCollectionKey | null) => void;
  /** Rows may peek (expand in place) where the presentation allows it. */
  expandable?: boolean;
  /**
   * Wide screens always have a selection: the last visited item, else the first. The model records
   * each opened item here. `ready: false` holds the landing until the items are known, so "first" is
   * never a guess.
   */
  initialSelection?: Readonly<{ memory: HappierCollectionVisitMemory<HappierCollectionKey>; ready?: boolean }>;
  /** The draft being added, while its route is open. */
  draft?: HappierCollectionDraftInput | null;
}>;

export type HappierCollectionActions = Readonly<{
  focus: (key: HappierCollectionKey) => void;
  toggleExpanded: (key: HappierCollectionKey) => void;
  open: (key: HappierCollectionKey) => void;
  close: () => void;
  /** Dispatches one of the list presentation's keys; `true` when the key was the Collection's. */
  handleKey: (key: string) => boolean;
}>;

export type HappierCollectionModel<Item> = Readonly<{
  /** The caller's identity rule, so a presentation keys its cells exactly as the model does. */
  keyOf: (item: Item) => HappierCollectionKey;
  sections: readonly HappierCollectionSection<Item>[];
  /** Every reachable key in traversal order, the draft first. */
  keys: readonly HappierCollectionKey[];
  window: HappierCollectionWindow;
  focusKey: HappierCollectionKey | null;
  selection: HappierListMultiSelectionSnapshot | null;
  selectionStore: HappierListMultiSelectionStore | null;
  expanded: ReadonlySet<HappierCollectionKey>;
  openKey: HappierCollectionKey | null;
  draft: HappierCollectionDraft | null;
  /** Measured once by the split geometry, read by everyone; `null` outside one. */
  layout: HappierCollectionLayoutState | null;
  /** Where a wide Collection with nothing open should land, for the caller to navigate to. */
  landingKey: HappierCollectionKey | null;
  actions: HappierCollectionActions;
}>;

const EMPTY_EXPANDED: ReadonlySet<HappierCollectionKey> = new Set();
const identityKey = (key: HappierCollectionKey) => key;

/**
 * Records the item a Collection's route opens in its visit memory, which the wide-screen landing
 * reads. A layout mounted beside the list and in the pushed (narrow) page alike calls it with the
 * route's item, so a visit counts whichever composition opened it. `keyOf` gives the visit's
 * identity, so re-renders do not re-record.
 */
export function useHappierCollectionVisit<Visit>(
  record: ((visit: Visit) => void) | null,
  visit: Visit | null,
  keyOf: (visit: Visit) => string,
): void {
  const key = visit === null ? null : keyOf(visit);
  const visitRef = useRef(visit);
  visitRef.current = visit;
  useEffect(() => {
    if (record !== null && visitRef.current !== null) record(visitRef.current);
  }, [key, record]);
}
const noopSubscribe = () => () => {};
const readInertSnapshot = () => HAPPIER_LIST_MULTI_SELECTION_INERT_SNAPSHOT;

/**
 * The headless Collection model (COLLECTION.md §2). It owns the Collection's facts — sections,
 * window, focus, selection, the expanded set, the open item and the layout — and nothing about how a
 * presentation draws them. The open item is the caller's route; a drop or an action is the caller's.
 */
export function useHappierCollection<Item>(input: HappierCollectionModelInput<Item>): HappierCollectionModel<Item> {
  const { items, keyOf, groups, order, filter } = input;
  const sections = useMemo(
    () => deriveHappierCollectionSections({
      items, keyOf, ...(groups ? { groups } : {}), ...(order ? { order } : {}), ...(filter ? { filter } : {}),
    }),
    [filter, groups, items, keyOf, order],
  );
  const draftInput = input.draft ?? null;
  const itemKeys = useMemo(
    () => sections.flatMap((section) => section.items.map(keyOf)),
    [keyOf, sections],
  );
  const draftKey = draftInput?.key ?? null;
  const keys = useMemo(
    () => (draftKey === null ? itemKeys : [draftKey, ...itemKeys]),
    [draftKey, itemKeys],
  );

  // ---- selection: the existing multi-selection store, fed the rows only this model can see ----
  const multiple = input.selection === 'multiple';
  const [selectionStore] = useState<HappierListMultiSelectionStore | null>(
    () => (multiple ? createHappierListMultiSelectionStore({ scopeKey: 'collection', visibleOrderedKeys: [] }) : null),
  );
  useEffect(() => {
    selectionStore?.setVisibleRows({ visibleOrderedKeys: itemKeys, eligibleKeys: itemKeys });
  }, [itemKeys, selectionStore]);
  const selectionSnapshot = useSyncExternalStore(
    selectionStore?.subscribe ?? noopSubscribe,
    selectionStore?.getSnapshot ?? readInertSnapshot,
    selectionStore?.getSnapshot ?? readInertSnapshot,
  );

  // ---- focus and peek: two facts that never derive from selection ----
  const [focusKey, setFocusKey] = useState<HappierCollectionKey | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<HappierCollectionKey>>(EMPTY_EXPANDED);
  const expandable = input.expandable === true;

  // ---- the open item is the route's ----
  const openKey = input.openKey;
  const onOpenChangeRef = useRef(input.onOpenChange);
  onOpenChangeRef.current = input.onOpenChange;
  const memory = input.initialSelection?.memory ?? null;
  useHappierCollectionVisit(memory?.record ?? null, openKey === draftKey ? null : openKey, identityKey);

  const layout = useHappierCollectionLayout();
  const landingReady = input.initialSelection?.ready !== false;
  const landingKey = memory !== null && landingReady && openKey === null && layout?.mode === 'split'
    ? resolveHappierCollectionInitialKey({ keys: itemKeys, lastVisited: memory.read() })
    : null;

  const localization = useOptionalHappierUiLocalization();
  const rtl = localization ? localization.direction === 'rtl' : I18nManager.isRTL;
  const commandInputRef = useRef({ keys, focusKey, openKey, expandable, rtl });
  commandInputRef.current = { keys, focusKey, openKey, expandable, rtl };

  const focus = useCallback((key: HappierCollectionKey) => {
    setFocusKey(key);
    selectionStore?.setFocusedKey(key);
  }, [selectionStore]);
  const toggleExpanded = useCallback((key: HappierCollectionKey) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const open = useCallback((key: HappierCollectionKey) => onOpenChangeRef.current(key), []);
  const close = useCallback(() => onOpenChangeRef.current(null), []);
  const handleKey = useCallback((key: string) => {
    const command = resolveHappierCollectionKeyCommand({ key, ...commandInputRef.current });
    if (command === null) return false;
    if (command.kind === 'focus') focus(command.key);
    else if (command.kind === 'toggleExpanded') toggleExpanded(command.key);
    else if (command.kind === 'open') open(command.key);
    else close();
    return true;
  }, [close, focus, open, toggleExpanded]);
  const actions = useMemo<HappierCollectionActions>(
    () => ({ focus, toggleExpanded, open, close, handleKey }),
    [close, focus, handleKey, open, toggleExpanded],
  );

  const draft = useMemo<HappierCollectionDraft | null>(
    () => (draftInput === null ? null : { ...draftInput, open: draftInput.key === openKey }),
    [draftInput, openKey],
  );

  return {
    keyOf,
    sections,
    keys,
    window: input.window ?? HAPPIER_COLLECTION_WINDOW_COMPLETE,
    focusKey,
    selection: selectionStore === null ? null : selectionSnapshot,
    selectionStore,
    expanded,
    openKey,
    draft,
    layout,
    landingKey,
    actions,
  };
}
