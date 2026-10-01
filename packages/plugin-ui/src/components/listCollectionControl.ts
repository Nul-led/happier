import { createContext, type MutableRefObject, type ReactNode } from 'react';

import type { HappierStyleProp } from '../presentation/portableTypes.js';

/**
 * @internal What the Collection (`Collection.tsx`) asks of the virtualized List engine it presents through. The
 * List stays the one owner of virtualization, roving focus, selection and grid semantics; this carries only the
 * few facts a presentation with exact row geometry needs from it. Package-private: not part of the public List.
 */
export type ListCollectionControl = Readonly<{
  /**
   * A key pressed on the focused row, offered before collection navigation. Returning `true` claims it (the
   * table's Space peek), so the row's own activation never sees it.
   */
  onRowKey?: (key: string, itemKey: string) => boolean;
  /** The scroll offset as the scroller reports it, and one scroll request (a new object is a new request). */
  scroll?: Readonly<{
    offsetRef: MutableRefObject<number>;
    request: Readonly<{ offset: number }> | null;
  }>;
  /** Group headers at the presentation's exact height, and the type role their words take. */
  sectionHeaderStyle?: HappierStyleProp;
  sectionHeaderTitleRole?: 'label' | 'caption';
  /** Wraps a group header cell (the shared-element travel moves headers with their rows). */
  wrapSectionHeader?: (sectionKey: string, header: ReactNode) => ReactNode;
  /** One control at the end of a group header ("See all"), by the group's author key; `null` for none. */
  sectionHeaderAction?: (sectionKey: string) => ReactNode;
  /**
   * The rows scroll with the page around them: the List does not scroll itself, sizes to its rows and renders every
   * row (a page-sized collection), so a page header above it and its footer below share one scroller and one focus
   * order with the rows.
   */
  pageScroll?: boolean;
}>;

export const ListCollectionControlContext = createContext<ListCollectionControl | null>(null);
