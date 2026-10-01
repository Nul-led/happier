import type { FeatureId } from '@happier-dev/protocol';
import type { HomeSettingEntryV1, HomeSettingsProjectionV1 } from '@happier-dev/protocol/home/governance';

import { homeFeatureTitle } from './homeFeatureLabels';
import { HOME_REACH_PAGE_SETTING_KEYS } from './homeReachSettings';
import { homeServerSettingRateLimitRoute, homeServerSettingTitle } from './homeServerSettingLabels';

/**
 * What the Server settings page shows (plan §3.10, §3.14 r3), from the one `home.settings.get`
 * projection:
 *
 * - every Home-editable key no bespoke page owns — the `server` and `runtime` sections, plus the
 *   `reach` and `policies` keys the Reach and Policies pages do not edit. Features, Data and Email
 *   own their sections; the Policies page owns the sign-in keys it routes to the governance policy
 *   (a `family`, or the `signup` group — the server's own classification); Reach owns its five keys;
 * - grouped into the three open sections of the lab (API and network, Storage and files,
 *   Monitoring) and closed groups under "More", derived from each entry's `group`/`family` so a
 *   group this app does not know yet still renders (humanised, before "Other");
 * - every read-only (`bootstrap`) key, whatever its section, in "Read-only at startup".
 *
 * Pending and ignored are the projection's own answers (`applied.pending`, `applied.ignoredReason`),
 * the same ones Runtime counts, so the two pages never disagree.
 */
export type HomeServerSettingsGroup = Readonly<{ id: string; entries: readonly HomeSettingEntryV1[] }>;

export type HomeServerSettingsLayout = Readonly<{
    primary: readonly HomeServerSettingsGroup[];
    more: readonly HomeServerSettingsGroup[];
    readOnly: readonly HomeSettingEntryV1[];
    /** Every setting on this Home the running server has not applied yet (any page's). */
    pending: readonly HomeSettingEntryV1[];
    /** Every setting whose stored value the last start ignored (any page's). */
    ignored: readonly HomeSettingEntryV1[];
    /** Settings on this page whose value this Home stores (the "Changed" filter). */
    changedCount: number;
}>;

const PRIMARY_GROUPS = ['api', 'storage', 'monitoring'] as const;

const MORE_ORDER = [
    'process', 'ui', 'realtime', 'retentionCaps', 'rpc', 'rateLimits', 'authCaches', 'limits',
    'liveActivity', 'voice', 'connectedServices', 'localServices', 'plugins', 'reviews', 'bugReports',
    'releases', 'github', 'oauth', 'oidc', 'workos', 'signInRequests', 'offboarding', 'friends',
    'accountService', 'devices', 'diagnostics', 'addresses', 'reachInference',
] as const;

const OTHER_GROUP = 'other';

/** The process keys that belong with the network settings rather than the process internals. */
const API_PROCESS_KEYS: ReadonlySet<string> = new Set(['PORT', 'HAPPIER_SERVER_HOST', 'HAPPIER_API_CORS_MAX_AGE_SECONDS']);

/** Whether this page renders the entry as an editable row (a bespoke page owns the rest). */
export function isHomeServerSettingsEntry(entry: HomeSettingEntryV1): boolean {
    if (entry.editable !== 'home') return false;
    const declaration = entry.declaration;
    if (!declaration) return false;
    switch (declaration.section) {
        case 'server':
        case 'runtime':
            return true;
        case 'reach':
            return !HOME_REACH_PAGE_SETTING_KEYS.has(entry.key);
        case 'policies':
            return declaration.family === undefined && declaration.group !== 'signup';
        case 'features':
        case 'data':
        case 'email':
            return false;
    }
}

export function homeServerSettingGroupOf(entry: HomeSettingEntryV1): string {
    const declaration = entry.declaration;
    if (!declaration) return OTHER_GROUP;
    if (declaration.family === 'rateLimits') return homeServerSettingRateLimitRoute(entry.key) ? 'rateLimits' : 'api';
    if (declaration.family?.startsWith('retention')) return 'retentionCaps';
    if (declaration.section === 'reach') return declaration.group === 'inference' ? 'reachInference' : 'addresses';
    switch (declaration.group) {
        case 'process':
            return API_PROCESS_KEYS.has(entry.key) ? 'api' : 'process';
        case 'storage':
        case 'database':
            return 'storage';
        case 'monitoring':
        case 'logging':
            return 'monitoring';
        case 'sockets':
        case 'presence':
            return 'realtime';
        case undefined:
            return OTHER_GROUP;
        default:
            return declaration.group;
    }
}

function moreRank(group: string): number {
    const index = (MORE_ORDER as readonly string[]).indexOf(group);
    if (index >= 0) return index;
    return group === OTHER_GROUP ? MORE_ORDER.length + 1 : MORE_ORDER.length;
}

/** The page's structure; rebuilt only when the projection changes. */
export function selectHomeServerSettings(settings: HomeSettingsProjectionV1): HomeServerSettingsLayout {
    const byGroup = new Map<string, HomeSettingEntryV1[]>();
    const readOnly: HomeSettingEntryV1[] = [];
    let changedCount = 0;
    for (const entry of settings.entries) {
        if (entry.editable === 'bootstrap') {
            readOnly.push(entry);
            continue;
        }
        if (!isHomeServerSettingsEntry(entry)) continue;
        if (entry.source === 'home') changedCount += 1;
        const group = homeServerSettingGroupOf(entry);
        const list = byGroup.get(group) ?? [];
        list.push(entry);
        byGroup.set(group, list);
    }
    const primary: HomeServerSettingsGroup[] = [];
    for (const id of PRIMARY_GROUPS) {
        const entries = byGroup.get(id);
        if (entries) primary.push(Object.freeze({ id, entries }));
    }
    const more = [...byGroup.entries()]
        .filter(([id]) => !(PRIMARY_GROUPS as readonly string[]).includes(id))
        .sort(([left], [right]) => moreRank(left) - moreRank(right) || left.localeCompare(right))
        .map(([id, entries]) => Object.freeze({ id, entries }));
    return Object.freeze({
        primary,
        more,
        readOnly,
        pending: settings.entries.filter((entry) => entry.applied?.pending === true),
        ignored: settings.entries.filter((entry) => entry.applied?.ignoredReason !== undefined),
        changedCount,
    });
}

/** A setting's name wherever it lives: a feature switch by its feature, anything else by its key. */
export function homeSettingTitle(entry: HomeSettingEntryV1): string {
    const featureId = entry.declaration?.featureId;
    return featureId ? homeFeatureTitle(featureId as FeatureId) : homeServerSettingTitle(entry.key);
}

export type HomeServerSettingsFilter = Readonly<{ query: string; changedOnly: boolean }>;

/**
 * The rows a search or the "Changed" filter leave, in the same groups. A changed row is one this
 * Home stores a value for, or one still pending a restart; a match is on the setting's name or its
 * environment key.
 */
export function filterHomeServerSettings(
    layout: HomeServerSettingsLayout,
    filter: HomeServerSettingsFilter,
): HomeServerSettingsLayout {
    const query = filter.query.trim().toLowerCase();
    if (!query && !filter.changedOnly) return layout;
    const keep = (entry: HomeSettingEntryV1, editable: boolean): boolean => {
        if (filter.changedOnly && (!editable || (entry.source !== 'home' && entry.applied?.pending !== true))) return false;
        if (!query) return true;
        return entry.key.toLowerCase().includes(query) || homeSettingTitle(entry).toLowerCase().includes(query);
    };
    const groups = (list: readonly HomeServerSettingsGroup[]) => list
        .map((group) => ({ id: group.id, entries: group.entries.filter((entry) => keep(entry, true)) }))
        .filter((group) => group.entries.length > 0);
    return Object.freeze({
        ...layout,
        primary: groups(layout.primary),
        more: groups(layout.more),
        readOnly: layout.readOnly.filter((entry) => keep(entry, false)),
    });
}
