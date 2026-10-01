import { describe, expect, it } from 'vitest';

import { selectKeptAsideStash } from './keptAside';

describe('selectKeptAsideStash', () => {
    it('finds only the stash Happier kept for this branch when you switched away', () => {
        const stashes = [
            { stashRef: 'stash@{0}', kind: 'transient' as const, branch: 'v0.3', message: 'before rolling back' },
            { stashRef: 'stash@{1}', kind: 'branch' as const, branch: 'dev', createdAt: 10 },
            { stashRef: 'stash@{2}', kind: 'unmanaged' as const, branch: 'v0.3', message: 'WIP' },
            { stashRef: 'stash@{3}', kind: 'branch' as const, branch: 'v0.3', createdAt: 20 },
        ];
        expect(selectKeptAsideStash(stashes, 'v0.3')?.stashRef).toBe('stash@{3}');
        expect(selectKeptAsideStash(stashes, 'main')).toBeNull();
        expect(selectKeptAsideStash(stashes, null)).toBeNull();
    });
});
