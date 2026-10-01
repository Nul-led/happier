import type { WorkspaceUrlTransport } from './workspaceNavigationAdapter';
import type { WorkspaceNavigationEntry } from './workspaceNavigationHistory';

type BrowserHistoryBoundary = Pick<History, 'state' | 'pushState' | 'replaceState' | 'go'>;

function browserEntryId(state: unknown): string | null {
    if (!state || typeof state !== 'object') return null;
    const id = (state as Record<string, unknown>).id;
    return typeof id === 'string' ? id : null;
}

/**
 * Expo/React Navigation is a URL mirror, while the workspace owns navigation.
 * React Navigation's installed createMemoryHistory preserves the browser entry
 * `id` but rewrites state to `{ id }`. Keep the workspace entry in session memory
 * against that same id; history and recently-visited destinations are not persisted.
 */
export function createWorkspaceBrowserTransport(input: Readonly<{
    history: BrowserHistoryBoundary;
    getHref: () => string;
    mirror: (href: string) => void;
    createId: () => string;
    accept: (href: string, entry: WorkspaceNavigationEntry, position: number) => void;
    /** Runs against the still-current destination, including cancelled unsaved-edit decisions. */
    guard?: (direction: -1 | 1, proceed: () => void) => void;
    needsGuard?: (direction: -1 | 1) => boolean;
}>): WorkspaceUrlTransport & Readonly<{
    acceptPopState: (state: unknown) => boolean;
}> {
    const entries = new Map<string, Readonly<{ entry: WorkspaceNavigationEntry; position: number }>>();
    let currentPosition: number | null = null;
    let currentId: string | null = null;
    let authorizedId: string | null = null;
    let pending: Readonly<{ sourceId: string; targetId: string; delta: number }> | null = null;
    return {
        adoptCurrent(entry, position) {
            pending = null;
            authorizedId = null;
            currentPosition = position;
            const id = browserEntryId(input.history.state) ?? input.createId();
            currentId = id;
            entries.set(id, { entry, position });
            if (browserEntryId(input.history.state) === null) {
                const state = input.history.state;
                input.history.replaceState({ ...(state && typeof state === 'object' ? state : {}), id }, '', input.getHref());
            }
        },
        commit(href, entry, replace, position) {
            pending = null;
            authorizedId = null;
            currentPosition = position;
            const id = replace ? browserEntryId(input.history.state) ?? input.createId() : input.createId();
            currentId = id;
            entries.set(id, { entry, position });
            const state = input.history.state;
            const next = { ...(state && typeof state === 'object' ? state : {}), id };
            if (replace) input.history.replaceState(next, '', href);
            else input.history.pushState(next, '', href);
            input.mirror(href);
        },
        traverse(direction) { input.history.go(direction); },
        acceptPopState(state) {
            const id = browserEntryId(state);
            const found = id ? entries.get(id) : undefined;
            if (!found) return false;
            if (pending && id === pending.sourceId) {
                const decision = pending;
                input.guard?.(decision.delta < 0 ? -1 : 1, () => {
                    if (pending !== decision) return;
                    pending = null;
                    authorizedId = decision.targetId;
                    input.history.go(decision.delta);
                });
                return true;
            }
            const direction = currentPosition !== null && found.position < currentPosition ? -1 : 1;
            if (input.guard && (input.needsGuard?.(direction) ?? true)
                && currentPosition !== null && found.position !== currentPosition && authorizedId !== id) {
                if (currentId && id) {
                    const delta = found.position - currentPosition;
                    pending = { sourceId: currentId, targetId: id, delta };
                    // Native pop has already changed the URL. Restore without adding
                    // an entry before asking the current editor whether it may leave.
                    input.history.go(-delta);
                    return true;
                }
            }
            pending = null;
            authorizedId = null;
            currentPosition = found.position;
            currentId = id;
            input.accept(input.getHref(), found.entry, found.position);
            input.mirror(input.getHref());
            return true;
        },
    };
}
