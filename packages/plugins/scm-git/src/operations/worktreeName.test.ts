import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    buildWorktreeRelativePath,
    hasForbiddenGitRefName,
    normalizeWorktreeDisplayName,
} from '@happier-dev/plugin-sdk/scm';
import { buildWorktreeTargetPath } from './worktreeName.js';

describe('git plugin worktree name canonicalization', () => {
    it('normalizes nested, Windows, duplicate separator, and dot-segment display names', () => {
        expect(normalizeWorktreeDisplayName('feature/auth')).toBe('feature/auth');
        expect(normalizeWorktreeDisplayName('feature\\auth')).toBe('feature/auth');
        expect(normalizeWorktreeDisplayName('feature//auth\\\\fix')).toBe('feature/auth/fix');
        expect(normalizeWorktreeDisplayName(' feature / ../ auth..fix ')).toBe('feature/auth-fix');
    });

    it('rejects forbidden git ref segments without rewriting them', () => {
        expect(hasForbiddenGitRefName('@')).toBe(true);
        expect(hasForbiddenGitRefName('feature/@')).toBe(true);
        expect(hasForbiddenGitRefName('feature.lock')).toBe(true);
        expect(hasForbiddenGitRefName('feature/inner.lock')).toBe(true);
        expect(hasForbiddenGitRefName('feature/auth')).toBe(false);
    });

    it('builds one canonical managed worktree path for relative and materialized checkouts', () => {
        expect(buildWorktreeRelativePath('feature/auth')).toBe('.dev/worktree/feature/auth');
        expect(buildWorktreeTargetPath('/repo', 'feature/auth')).toBe(join('/repo', '.dev', 'worktree', 'feature', 'auth'));
    });
});
