import { SessionSurfaceItemIdSchema } from '@happier-dev/protocol/sessions';
import { z } from 'zod';

/**
 * Session Companion is a viewer/device-local presentation preference: which
 * Session items this person keeps beside Chat, in what order, on which logical
 * edge, at which density.
 *
 * It stores references and presentation choices only. Never item bytes, inputs,
 * grants, plugin generation, Session facts or render state — the Session record
 * remains the content authority, and removing a Companion reference never
 * removes the shared item.
 */
export const SESSION_COMPANION_BUILTIN_ITEM_IDS = ['session_summary'] as const;
export type SessionCompanionBuiltinItemId = (typeof SESSION_COMPANION_BUILTIN_ITEM_IDS)[number];

export type SessionCompanionItemRefV1 =
    | Readonly<{ kind: 'builtin'; id: SessionCompanionBuiltinItemId }>
    | Readonly<{ kind: 'widget'; widgetId: string }>;

export type SessionCompanionEdge = 'leading' | 'trailing';
export type SessionCompanionDensity = 'compact' | 'comfortable';

export type SessionCompanionPreferenceV1 = Readonly<{
    v: 1;
    visible: boolean;
    collapsed: boolean;
    edge: SessionCompanionEdge;
    density: SessionCompanionDensity;
    items: readonly SessionCompanionItemRefV1[];
}>;

/**
 * The implicit preference for a Session with no stored entry, and the value a
 * stored entry this client cannot read resolves to. Merely opening a Session
 * never writes it.
 */
export const HIDDEN_SESSION_COMPANION_PREFERENCE_V1: SessionCompanionPreferenceV1 = Object.freeze({
    v: 1,
    visible: false,
    collapsed: false,
    edge: 'trailing',
    density: 'compact',
    items: Object.freeze([]) as readonly SessionCompanionItemRefV1[],
});

export const SESSION_SUMMARY_COMPANION_ITEM: SessionCompanionItemRefV1 = Object.freeze({
    kind: 'builtin',
    id: 'session_summary',
});

const sessionCompanionItemRefSchema = z.union([
    z.object({
        kind: z.literal('builtin'),
        id: z.enum(SESSION_COMPANION_BUILTIN_ITEM_IDS),
    }).strict(),
    z.object({
        kind: z.literal('widget'),
        // The sibling Session surface item identifier owner; Companion adds no
        // second widget-id grammar.
        widgetId: SessionSurfaceItemIdSchema,
    }).strict(),
]);

const sessionCompanionPreferenceV1Schema = z.object({
    v: z.literal(1),
    visible: z.boolean(),
    collapsed: z.boolean(),
    edge: z.enum(['leading', 'trailing']),
    density: z.enum(['compact', 'comfortable']),
    items: z.array(sessionCompanionItemRefSchema),
}).strict();

/**
 * Entries are admitted independently. One corrupt Session preference must not
 * discard every other Session's preference, and a malformed root must not fail
 * the whole local-settings parse and reset unrelated settings.
 */
export const SessionCompanionPreferencesV1Schema = z.preprocess(
    (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        const admitted: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            if (sessionCompanionPreferenceV1Schema.safeParse(entry).success) {
                admitted[key] = entry;
            }
        }
        return admitted;
    },
    z.record(z.string(), sessionCompanionPreferenceV1Schema),
).catch({});

export type SessionCompanionPreferencesV1 = z.infer<typeof SessionCompanionPreferencesV1Schema>;

export function sessionCompanionItemKey(item: SessionCompanionItemRefV1): string {
    return item.kind === 'builtin' ? `builtin:${item.id}` : `widget:${item.widgetId}`;
}

export function areSessionCompanionItemsEqual(
    first: SessionCompanionItemRefV1,
    second: SessionCompanionItemRefV1,
): boolean {
    return sessionCompanionItemKey(first) === sessionCompanionItemKey(second);
}

function freezeItems(items: readonly SessionCompanionItemRefV1[]): readonly SessionCompanionItemRefV1[] {
    return Object.freeze(items.map((item) => Object.freeze({ ...item }) as SessionCompanionItemRefV1));
}

/**
 * Resolves one stored entry to the preference this client can act on. An absent,
 * unreadable or newer-version entry resolves to the hidden implicit default.
 * Duplicate references keep their first occurrence so a stale write cannot
 * silently reorder the list.
 */
export function normalizeSessionCompanionPreference(
    stored: unknown,
): SessionCompanionPreferenceV1 {
    const parsed = sessionCompanionPreferenceV1Schema.safeParse(stored);
    if (!parsed.success) return HIDDEN_SESSION_COMPANION_PREFERENCE_V1;

    const seen = new Set<string>();
    const items: SessionCompanionItemRefV1[] = [];
    for (const item of parsed.data.items as readonly SessionCompanionItemRefV1[]) {
        const key = sessionCompanionItemKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(item);
    }

    return Object.freeze({
        v: 1,
        visible: parsed.data.visible,
        collapsed: parsed.data.collapsed,
        edge: parsed.data.edge,
        density: parsed.data.density,
        items: freezeItems(items),
    });
}

/** True when this client cannot read a stored entry it must not overwrite on read. */
export function isUnreadableSessionCompanionPreference(stored: unknown): boolean {
    if (stored === undefined) return false;
    return !sessionCompanionPreferenceV1Schema.safeParse(stored).success;
}

function withItems(
    preference: SessionCompanionPreferenceV1,
    items: readonly SessionCompanionItemRefV1[],
): SessionCompanionPreferenceV1 {
    return Object.freeze({ ...preference, items: freezeItems(items) });
}

/**
 * Show the Companion. An explicitly requested item is added when absent; a bare
 * `show()` seeds the built-in Session Summary only when nothing is selected yet.
 */
export function showSessionCompanion(
    preference: SessionCompanionPreferenceV1,
    item?: SessionCompanionItemRefV1,
): SessionCompanionPreferenceV1 {
    const base = Object.freeze({ ...preference, visible: true, collapsed: false });
    if (item) return addSessionCompanionItem(base, item);
    if (base.items.length > 0) return base;
    return withItems(base, [SESSION_SUMMARY_COMPANION_ITEM]);
}

/** Hiding preserves items, order, collapse, density and edge for quick restoration. */
export function hideSessionCompanion(
    preference: SessionCompanionPreferenceV1,
): SessionCompanionPreferenceV1 {
    return Object.freeze({ ...preference, visible: false });
}

export function setSessionCompanionCollapsed(
    preference: SessionCompanionPreferenceV1,
    collapsed: boolean,
): SessionCompanionPreferenceV1 {
    return Object.freeze({ ...preference, collapsed });
}

export function setSessionCompanionEdge(
    preference: SessionCompanionPreferenceV1,
    edge: SessionCompanionEdge,
): SessionCompanionPreferenceV1 {
    return Object.freeze({ ...preference, edge });
}

export function setSessionCompanionDensity(
    preference: SessionCompanionPreferenceV1,
    density: SessionCompanionDensity,
): SessionCompanionPreferenceV1 {
    return Object.freeze({ ...preference, density });
}

function clampInsertIndex(length: number, index: number | undefined): number {
    if (index === undefined || !Number.isFinite(index)) return length;
    return Math.min(Math.max(Math.trunc(index), 0), length);
}

export function addSessionCompanionItem(
    preference: SessionCompanionPreferenceV1,
    item: SessionCompanionItemRefV1,
    index?: number,
): SessionCompanionPreferenceV1 {
    if (preference.items.some((candidate) => areSessionCompanionItemsEqual(candidate, item))) {
        return preference;
    }
    const next = [...preference.items];
    next.splice(clampInsertIndex(next.length, index), 0, item);
    return withItems(preference, next);
}

/**
 * Removing the last item leaves a deliberate empty customization state and hides
 * the card immediately. It never deletes shared content.
 */
export function removeSessionCompanionItem(
    preference: SessionCompanionPreferenceV1,
    item: SessionCompanionItemRefV1,
): SessionCompanionPreferenceV1 {
    const next = preference.items.filter((candidate) => !areSessionCompanionItemsEqual(candidate, item));
    if (next.length === preference.items.length) return preference;
    const withRemoved = withItems(preference, next);
    return next.length === 0 ? hideSessionCompanion(withRemoved) : withRemoved;
}

export function moveSessionCompanionItem(
    preference: SessionCompanionPreferenceV1,
    item: SessionCompanionItemRefV1,
    toIndex: number,
): SessionCompanionPreferenceV1 {
    const fromIndex = preference.items.findIndex((candidate) => areSessionCompanionItemsEqual(candidate, item));
    if (fromIndex < 0) return preference;
    const next = [...preference.items];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return preference;
    next.splice(clampInsertIndex(next.length, toIndex), 0, moved);
    return withItems(preference, next);
}

export function areSessionCompanionPreferencesEqual(
    first: SessionCompanionPreferenceV1,
    second: SessionCompanionPreferenceV1,
): boolean {
    if (
        first.visible !== second.visible
        || first.collapsed !== second.collapsed
        || first.edge !== second.edge
        || first.density !== second.density
        || first.items.length !== second.items.length
    ) {
        return false;
    }
    return first.items.every((item, index) => {
        const other = second.items[index];
        return other !== undefined && areSessionCompanionItemsEqual(item, other);
    });
}
