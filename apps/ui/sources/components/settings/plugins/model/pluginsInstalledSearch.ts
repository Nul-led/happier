import { create } from 'zustand';

type PluginsInstalledSearchState = Readonly<{ query: string }>;

/**
 * The one query over the installed plugins. The Plugins column's search writes it and the Plugins
 * page's grid and list filter by it; where no column is shown (the Settings host, a hidden column)
 * the page's toolbar field writes the same query. One control is on screen at a time, over one state.
 * It is presentation state for this device's session, so it is kept in memory only.
 */
const usePluginsInstalledSearchStore = create<PluginsInstalledSearchState>(() => ({ query: '' }));

export function usePluginsInstalledQuery(): string {
    return usePluginsInstalledSearchStore((state) => state.query);
}

export function readPluginsInstalledQuery(): string {
    return usePluginsInstalledSearchStore.getState().query;
}

export function setPluginsInstalledQuery(query: string): void {
    if (usePluginsInstalledSearchStore.getState().query === query) return;
    usePluginsInstalledSearchStore.setState({ query });
}
