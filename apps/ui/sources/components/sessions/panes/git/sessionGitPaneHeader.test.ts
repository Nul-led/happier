import { describe, expect, it } from 'vitest';

import { resolveSessionGitPaneActions, resolveSessionGitPaneHeaderFacts } from './sessionGitPaneHeader';

// Git lab A/S/ST/CF: the header says where you are and the one change count; its trailing action is the
// next sync step (never Commit — the commit form owns that), primary only while no commit is ready.
describe('resolveSessionGitPaneActions', () => {
    const available = [
        { key: 'fetch', disabled: false },
        { key: 'pull', disabled: false },
        { key: 'push', disabled: false },
    ];
    const base = {
        changedCount: 0, ahead: 0, behind: 0, upstream: 'origin/v0.3', hasConflicts: false,
        prState: 'none' as const, prNumber: null, canCreatePr: true, commitReady: false, remoteActions: available,
    };

    it('keeps the sync step in the header while files are changed, secondary only while a commit is ready', () => {
        expect(resolveSessionGitPaneActions({ ...base, changedCount: 14, ahead: 2, commitReady: true }).primary)
            .toEqual({ key: 'push', count: 2, disabled: false, emphasis: 'secondary' });
        expect(resolveSessionGitPaneActions({ ...base, changedCount: 11, ahead: 3 }).primary)
            .toEqual({ key: 'push', count: 3, disabled: false, emphasis: 'primary' });
    });

    it('orders the next step Resolve, Publish, Pull, Push, Create PR, then the open PR or Up to date', () => {
        expect(resolveSessionGitPaneActions({ ...base, hasConflicts: true, conflictCount: 2, changedCount: 14, commitReady: true }).primary)
            .toMatchObject({ key: 'resolve', count: 2, emphasis: 'primary' });
        expect(resolveSessionGitPaneActions({ ...base, upstream: null, remoteActions: [...available, { key: 'publish', disabled: false }] }).primary)
            .toMatchObject({ key: 'publish', emphasis: 'primary' });
        expect(resolveSessionGitPaneActions({ ...base, ahead: 3, behind: 2 }).primary).toMatchObject({ key: 'pull', count: 2 });
        expect(resolveSessionGitPaneActions({ ...base, ahead: 3 }).primary).toMatchObject({ key: 'push', count: 3 });
        expect(resolveSessionGitPaneActions({ ...base, changedCount: 11 }).primary).toMatchObject({ key: 'create-pr', emphasis: 'primary' });
        expect(resolveSessionGitPaneActions({ ...base, prState: 'open', prNumber: 2501 }).primary)
            .toEqual({ key: 'open-pr', count: 2501, disabled: false, emphasis: 'quiet' });
        expect(resolveSessionGitPaneActions({ ...base, prState: 'open', prNumber: null, canCreatePr: false }).primary)
            .toEqual({ key: 'up-to-date', count: null, disabled: true, emphasis: 'quiet' });
    });

    it('never offers an action the backend or policy does not allow, and keeps every alternative in the menu with its state', () => {
        // Ahead, but no push is offered: no button lies about pushing.
        expect(resolveSessionGitPaneActions({ ...base, ahead: 2, canCreatePr: false, remoteActions: [{ key: 'fetch', disabled: false }] }).primary)
            .toMatchObject({ key: 'up-to-date' });
        const offline = resolveSessionGitPaneActions({
            ...base, ahead: 3,
            remoteActions: available.map((action) => ({ ...action, disabled: true })),
        });
        expect(offline.primary).toEqual({ key: 'push', count: 3, disabled: true, emphasis: 'secondary' });
        expect(offline.menu.map((item) => item.key)).toEqual(['push', 'pull', 'fetch', 'create-pr']);
        expect(offline.menu).toContainEqual(expect.objectContaining({ key: 'pull', disabled: true }));
    });
});

describe('resolveSessionGitPaneHeaderFacts', () => {
    it('states the branch and the change count, and never repeats the number the action carries', () => {
        expect(resolveSessionGitPaneHeaderFacts({ branch: 'v0.3', changedCount: 14, ahead: 2, behind: 0, primaryKey: 'push' }))
            .toEqual([{ kind: 'branch', branch: 'v0.3' }, { kind: 'changed', count: 14 }]);
        expect(resolveSessionGitPaneHeaderFacts({ branch: 'main', changedCount: 0, ahead: 1, behind: 4, primaryKey: 'pull' }))
            .toEqual([{ kind: 'branch', branch: 'main' }, { kind: 'clean' }, { kind: 'toPush', count: 1 }]);
    });
});
