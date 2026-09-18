import { describe, expect, it } from 'vitest';

import { createWorktreeAttributionRegistry } from './worktreeAttributionRegistry';

describe('createWorktreeAttributionRegistry', () => {
    it('keeps observed overlap on every overlapping interval regardless of completion order', () => {
        const registry = createWorktreeAttributionRegistry();
        const first = registry.begin({ repoRoot: '/repo', intervalId: 'session-1:message-1' });

        expect(registry.resolveAttributionScope(first)).toBe('no_happier_checkpoint_overlap_observed');

        const second = registry.begin({ repoRoot: '/repo', intervalId: 'session-2:message-2' });

        expect(registry.resolveAttributionScope(first)).toBe('shared_worktree');
        expect(registry.resolveAttributionScope(second)).toBe('shared_worktree');

        registry.end(second);

        expect(registry.resolveAttributionScope(first)).toBe('shared_worktree');

        const reversed = createWorktreeAttributionRegistry();
        const left = reversed.begin({ repoRoot: '/repo', intervalId: 'session-1:message-1' });
        const right = reversed.begin({ repoRoot: '/repo', intervalId: 'session-2:message-2' });

        reversed.end(left);

        expect(reversed.resolveAttributionScope(right)).toBe('shared_worktree');
    });

    it('marks every interval of a three-way overlap', () => {
        const registry = createWorktreeAttributionRegistry();
        const first = registry.begin({ repoRoot: '/repo', intervalId: 'session-1:message-1' });
        const second = registry.begin({ repoRoot: '/repo', intervalId: 'session-2:message-2' });
        const third = registry.begin({ repoRoot: '/repo', intervalId: 'session-3:message-3' });

        expect(registry.resolveAttributionScope(first)).toBe('shared_worktree');
        expect(registry.resolveAttributionScope(second)).toBe('shared_worktree');
        expect(registry.resolveAttributionScope(third)).toBe('shared_worktree');

        registry.end(second);

        expect(registry.resolveAttributionScope(first)).toBe('shared_worktree');
        expect(registry.resolveAttributionScope(third)).toBe('shared_worktree');

        registry.end(third);

        expect(registry.resolveAttributionScope(first)).toBe('shared_worktree');
    });

    it('observes concurrent intervals from the same session', () => {
        const registry = createWorktreeAttributionRegistry();
        const first = registry.begin({ repoRoot: '/repo', intervalId: 'session-1:message-1' });
        const second = registry.begin({ repoRoot: '/repo', intervalId: 'session-1:message-2' });

        expect(registry.resolveAttributionScope(first)).toBe('shared_worktree');
        expect(registry.resolveAttributionScope(second)).toBe('shared_worktree');
    });

    it('does not observe overlap across distinct resolved roots', () => {
        const registry = createWorktreeAttributionRegistry();
        const first = registry.begin({ repoRoot: '/repo-a', intervalId: 'session-1:message-1' });
        const second = registry.begin({ repoRoot: '/repo-b', intervalId: 'session-2:message-2' });

        expect(registry.resolveAttributionScope(first)).toBe('no_happier_checkpoint_overlap_observed');
        expect(registry.resolveAttributionScope(second)).toBe('no_happier_checkpoint_overlap_observed');
    });

    it('releases intervals idempotently and never reports exclusivity for an unregistered interval', () => {
        const registry = createWorktreeAttributionRegistry();
        const first = registry.begin({ repoRoot: '/repo', intervalId: 'session-1:message-1' });
        const second = registry.begin({ repoRoot: '/repo', intervalId: 'session-2:message-2' });

        registry.end(first);
        registry.end(first);
        registry.end(second);

        const later = registry.begin({ repoRoot: '/repo', intervalId: 'session-3:message-3' });

        expect(registry.resolveAttributionScope(later)).toBe('no_happier_checkpoint_overlap_observed');
        expect(registry.resolveAttributionScope({ repoRoot: '/repo', intervalId: 'never-registered' })).toBe('unknown');
        expect(registry.resolveAttributionScope({ repoRoot: '', intervalId: '' })).toBe('unknown');
    });

    it('does not reset already observed overlap when the same interval begins again', () => {
        const registry = createWorktreeAttributionRegistry();
        const first = registry.begin({ repoRoot: '/repo', intervalId: 'session-1:message-1' });
        const second = registry.begin({ repoRoot: '/repo', intervalId: 'session-2:message-2' });

        registry.end(second);
        registry.begin(first);

        expect(registry.resolveAttributionScope(first)).toBe('shared_worktree');
    });
});
