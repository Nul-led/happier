import { createContext, useContext } from 'react';

import type { HappierListDetailLayoutState } from './listDetailGeometry.js';

/**
 * How a Collection is currently composed: `split` puts the list beside the detail, `stacked` shows one
 * pane (a narrow screen), and `measuring` precedes the first measured layout.
 *
 * The split geometry is the only owner of this fact. It publishes the state in the same render that
 * measured it, so a detail page (an index route inside a nested stack, say) reads the current mode
 * directly instead of through a copy that an effect keeps in step one commit late.
 */
export type HappierCollectionLayoutMode = 'measuring' | HappierListDetailLayoutState['mode'];

/**
 * Only the mode is published, one frozen value per mode, so a resize that keeps the mode re-renders
 * no reader; the pane widths stay inside the split geometry.
 */
export type HappierCollectionLayoutState = Readonly<{ mode: HappierCollectionLayoutMode }>;

const HAPPIER_COLLECTION_LAYOUT_STATES: Readonly<Record<HappierCollectionLayoutMode, HappierCollectionLayoutState>> = Object.freeze({
  measuring: Object.freeze({ mode: 'measuring' }),
  split: Object.freeze({ mode: 'split' }),
  stacked: Object.freeze({ mode: 'stacked' }),
});

/** @internal Provided only by the split geometry (`HappierListDetailLayout`). */
export const HappierCollectionLayoutContext = createContext<HappierCollectionLayoutState | null>(null);

/** @internal The provider value before the first measurement. */
export function resolveHappierCollectionLayoutState(
  measured: HappierListDetailLayoutState | null,
): HappierCollectionLayoutState {
  return HAPPIER_COLLECTION_LAYOUT_STATES[measured?.mode ?? 'measuring'];
}

/**
 * The Collection's layout, or `null` outside a Collection (a page rendered on its own route, not as a
 * Collection's detail).
 */
export function useHappierCollectionLayout(): HappierCollectionLayoutState | null {
  return useContext(HappierCollectionLayoutContext);
}

/**
 * What a Collection's index route shows. Beside the list something is always open, so the index
 * `land`s on an item (and renders nothing of its own); where the list is not beside it — a narrow
 * screen, or outside a Collection — the index IS the list. Before the first measurement it shows
 * nothing, so neither choice flashes.
 */
export type HappierCollectionIndexView = 'pending' | 'land' | 'list';

export function resolveHappierCollectionIndexView(layout: HappierCollectionLayoutState | null): HappierCollectionIndexView {
  if (layout === null) return 'list';
  if (layout.mode === 'measuring') return 'pending';
  return layout.mode === 'split' ? 'land' : 'list';
}

export function useHappierCollectionIndexView(): HappierCollectionIndexView {
  return resolveHappierCollectionIndexView(useHappierCollectionLayout());
}
