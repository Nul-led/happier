import * as React from 'react';

/**
 * How grouped list content is presented.
 *
 * - `grouped`: the compact inset-grouped look (uppercase header, footer under the card). It stays the
 *   look of menus, pickers, sheets and every list that is not a full configuration page.
 * - `page`: the configuration-page anatomy (sentence-case section heading with its description above
 *   the rows, a hairline sheet with row dividers, paper background). A full-page `ItemList` opts in
 *   and every `ItemGroup`/`Item` below it follows.
 *
 * Floating surfaces (menus, popovers) reset to `grouped` so a menu opened from a page never inherits
 * page anatomy — see `FloatingOverlay`.
 */
export type ListPresentation = 'grouped' | 'page';

const ListPresentationContext = React.createContext<ListPresentation>('grouped');

export function ListPresentationProvider(props: Readonly<{ value: ListPresentation; children: React.ReactNode }>) {
    return <ListPresentationContext.Provider value={props.value}>{props.children}</ListPresentationContext.Provider>;
}

export function useListPresentation(): ListPresentation {
    return React.useContext(ListPresentationContext);
}
