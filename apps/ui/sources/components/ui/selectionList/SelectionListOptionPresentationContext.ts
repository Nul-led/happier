import * as React from 'react';

import type { SelectionListOptionPresentation } from './_types';

/**
 * Option presentation is a property of the whole list, not of one row, and it
 * is published exactly the way the ARIA pattern already is (see
 * `SelectionListA11yPatternContext`): `SelectionListBody` resolves it once and
 * every row path — plain, animated, per-section virtualized, and flat
 * virtualized — reads the SAME decision.
 *
 * Why a context rather than a prop: those four row paths already drill
 * `columnCount` through `SelectionListBody` → section renderers /
 * `SelectionListVirtualizedBody` → `PlanSuccessRows` → `PlanOptionRow`.
 * `columnCount` has to travel that way because intermediate layers CONSUME it
 * (chunking, grid geometry, virtualized item construction). Presentation is
 * consumed only by the leaf row, so a second parallel drill would add four
 * pass-through props that no intermediate layer reads.
 *
 * Defaults to `'row'`, so a row rendered outside a body (unit tests, story
 * surfaces) keeps the historical flush-row tree.
 */
export const SelectionListOptionPresentationContext =
    React.createContext<SelectionListOptionPresentation>('row');

/**
 * How a row marks itself, published beside the presentation by `SelectionListBody`:
 * - `'check'`: the one current choice of a single-choice list carries a trailing check (the picker
 *   anatomy: fill + check);
 * - `'enter'`: a command list (⌘K) marks the row the keyboard is on with the ↵ that runs it;
 * - `null`: multiple-choice lists keep their checkbox semantics, card presentation its corner
 *   overlay, and a row rendered outside a body its historical tree.
 */
export type SelectionListRowMark = 'check' | 'enter' | null;
export const SelectionListSelectedMarkContext = React.createContext<SelectionListRowMark>(null);
