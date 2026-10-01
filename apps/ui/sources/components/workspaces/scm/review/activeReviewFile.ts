import * as React from 'react';
import { buildWorkspaceCacheKey, type WorkspaceScopeBase } from '@/sync/domains/workspaces/workspaceScope';

/**
 * The one "active review file" per review scope (a Session address, a workspace): which changed file
 * Review is showing, and a request from a changed-files list to show another. Review publishes; the
 * Git changed-files list (and any list that replaces it) highlights, reveals and asks — neither owns
 * the other's scroll. It is presentation state only: nothing is persisted, and it holds nothing while
 * Review is not on screen, so a list never points at a Review that isn't there.
 */
export type ActiveReviewFileState = Readonly<{
    /** Review is open and on screen for this scope. */
    presented: boolean;
    /** The file Review shows (null while Review is not on screen). */
    activePath: string | null;
    /** The last file a list asked Review to show; a new nonce for every ask. */
    focusRequest: Readonly<{ path: string; nonce: number }> | null;
}>;

const EMPTY: ActiveReviewFileState = Object.freeze({ presented: false, activePath: null, focusRequest: null });

const states = new Map<string, ActiveReviewFileState>();
const listeners = new Map<string, Set<() => void>>();
let nextNonce = 1;

function write(key: string, next: ActiveReviewFileState): void {
    states.set(key, next);
    for (const listener of listeners.get(key) ?? []) listener();
}

export function readActiveReviewFile(key: string): ActiveReviewFileState {
    return states.get(key) ?? EMPTY;
}

export function subscribeActiveReviewFile(key: string, listener: () => void): () => void {
    let set = listeners.get(key);
    if (!set) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(listener);
    return () => {
        set?.delete(listener);
        if (set && set.size === 0) listeners.delete(key);
    };
}

/** Review reports whether it is on screen and which file it is on. Unchanged facts notify nobody. */
export function publishActiveReviewFile(key: string, input: Readonly<{ presented: boolean; activePath: string | null }>): void {
    const current = readActiveReviewFile(key);
    const activePath = input.presented ? input.activePath : null;
    if (current.presented === input.presented && current.activePath === activePath) return;
    write(key, { presented: input.presented, activePath, focusRequest: input.presented ? current.focusRequest : null });
}

/**
 * A list asks Review to show a file. Answers whether Review took it (it is on screen); when not, the
 * list keeps its own action (opening the file).
 */
export function requestActiveReviewFile(key: string, path: string): boolean {
    const current = readActiveReviewFile(key);
    if (!current.presented) return false;
    write(key, { ...current, focusRequest: { path, nonce: nextNonce++ } });
    return true;
}

function useActiveReviewFileSelector<T>(key: string | null, select: (state: ActiveReviewFileState) => T): T {
    const subscribe = React.useCallback(
        (listener: () => void) => (key ? subscribeActiveReviewFile(key, listener) : () => {}),
        [key],
    );
    const getSnapshot = () => select(key ? readActiveReviewFile(key) : EMPTY);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The file Review is on, for a list that reveals it (null while Review is not on screen). */
export function useActiveReviewFilePath(key: string | null): string | null {
    return useActiveReviewFileSelector(key, (state) => state.activePath);
}

/** Row-local: whether this row is Review's file. Only the two rows that change re-render. */
export function useIsActiveReviewFile(key: string | null, path: string): boolean {
    return useActiveReviewFileSelector(key, (state) => state.activePath === path);
}

/** Review consumes list requests. */
export function useActiveReviewFileRequest(key: string | null): ActiveReviewFileState['focusRequest'] {
    return useActiveReviewFileSelector(key, (state) => state.focusRequest);
}

export function resetActiveReviewFilesForTests(): void {
    states.clear();
    listeners.clear();
}

/** The scope key a Session's Review and its Git changed-files list share. */
export function activeReviewFileKeyForSession(sessionId: string, serverId?: string | null): string {
    return `session:${serverId ?? ''}:${sessionId}`;
}

/** Review and Git share the canonical normalized workspace identity, including its Home and machine. */
export function activeReviewFileKeyForWorkspace(scope: WorkspaceScopeBase): string {
    return `workspace:${buildWorkspaceCacheKey(scope)}`;
}

/**
 * A changed-files list row was tapped: with Review on screen the file is shown there (Review scrolls
 * to it); otherwise the list keeps its own action and opens the file.
 */
export function openChangedFileFromList(key: string | null, path: string, open: (path: string) => void): void {
    if (key && requestActiveReviewFile(key, path)) return;
    open(path);
}
