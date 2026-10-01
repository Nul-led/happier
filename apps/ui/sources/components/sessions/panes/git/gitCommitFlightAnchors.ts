import * as React from 'react';
import type { View } from 'react-native';

/**
 * Where the Git pane's commit moment starts and ends (Git lab SX): the rows of the files selected for the commit,
 * and the timeline's newest commit (where the commit chip lands). Rows and the timeline register their views here;
 * the commit tab measures them. A plain registry (no state): registering never re-renders anything.
 */
export type GitCommitFlightAnchors = Readonly<{
    rows: Map<string, View>;
    newestCommit: { current: View | null };
}>;

export function createGitCommitFlightAnchors(): GitCommitFlightAnchors {
    return { rows: new Map(), newestCommit: { current: null } };
}

export const GitCommitFlightAnchorsContext = React.createContext<GitCommitFlightAnchors | null>(null);

/** A ref callback that keeps `path`'s row view registered while it is mounted (recycled cells re-register). */
export function registerGitCommitFlightRow(anchors: GitCommitFlightAnchors | null, path: string) {
    let registered: View | null = null;
    return (view: View | null) => {
        if (!anchors) return;
        if (view) {
            registered = view;
            anchors.rows.set(path, view);
        } else if (registered && anchors.rows.get(path) === registered) {
            anchors.rows.delete(path);
            registered = null;
        }
    };
}
