import * as React from 'react';

import { createSessionPaneDetailsTab, parseSessionPaneUrlState } from '@/components/sessions/panes/url/sessionPaneUrlState';
import { resolveSettingsRouteTitleKey } from '@/components/settings/navigation/settingsRouteRegistry';
import { useSessionDisplayNameProjections } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { getSessionName, resolveLockedSessionTitle } from '@/utils/sessions/sessionUtils';
import { hrefForDestinationRef, resolveCurrentAppDestination, type CompactAppDestination, type DestinationRef } from './compactAppDestinationCatalog';

export type DestinationInstanceTitleEntry = Readonly<{ key: string; ref: DestinationRef }>;

/** A session's name as every surface shows it: the session title owner's, locked titles included. */
function sessionTitle(source: Parameters<typeof getSessionName>[0] | null): string | null {
    if (!source) return null;
    return resolveLockedSessionTitle(getSessionName(source, source.serverId));
}

/**
 * The title of what is open, without asking any store: a Details target's own title (its file name,
 * "Board", a terminal), a settings page's title, or the catalog's title for a plugin page or an
 * app area. `null` when only live data can name it (a session) or nothing can.
 */
function resolveStaticInstanceTitle(catalog: readonly CompactAppDestination[], ref: DestinationRef): string | null {
    if (ref.kind === 'newTab') return t('browser.tabs.newTab');
    if (ref.kind === 'session') return null;
    if (ref.kind === 'sessionDetails') {
        const details = parseSessionPaneUrlState(ref.params)?.details;
        return details ? createSessionPaneDetailsTab(details)?.title ?? null : null;
    }
    const href = hrefForDestinationRef(catalog, ref);
    if (!href) return null;
    if (ref.kind === 'settings') {
        const key = resolveSettingsRouteTitleKey(href.split(/[?#]/, 1)[0]);
        if (key) return t(key);
    }
    return resolveCurrentAppDestination(catalog, href)?.title ?? null;
}

/**
 * The live title of each open destination instance (workspace lab T: "its title comes from the
 * destination"): a session's current name, a Details target's own name, a settings page or plugin
 * page title. One resolver for every tab bar, keyed by the caller's tab key; a key is absent when the
 * instance cannot be named yet, so the caller shows its saved title (loading, unavailable).
 */
export function useDestinationInstanceTitles(
    catalog: readonly CompactAppDestination[],
    entries: readonly DestinationInstanceTitleEntry[],
): ReadonlyMap<string, string> {
    const sessionEntries = React.useMemo(() => entries.filter((entry) => (entry.ref.kind === 'session' || entry.ref.kind === 'sessionDetails')
        && typeof entry.ref.params.id === 'string' && entry.ref.params.id.length > 0), [entries]);
    const addresses = React.useMemo(() => sessionEntries.map((entry) => ({
        sessionId: entry.ref.params.id!, serverId: entry.ref.params.serverId ?? null,
    })), [sessionEntries]);
    const sessionTitles = useSessionDisplayNameProjections(addresses, sessionTitle);
    return React.useMemo(() => {
        const titles = new Map<string, string>();
        for (const entry of entries) {
            const title = resolveStaticInstanceTitle(catalog, entry.ref);
            if (title) titles.set(entry.key, title);
        }
        sessionEntries.forEach((entry, index) => {
            const name = sessionTitles[index];
            if (!name) return;
            // A Details tab names its target; a session tab names the session.
            if (entry.ref.kind === 'session') titles.set(entry.key, name);
        });
        return titles;
    }, [catalog, entries, sessionEntries, sessionTitles]);
}
