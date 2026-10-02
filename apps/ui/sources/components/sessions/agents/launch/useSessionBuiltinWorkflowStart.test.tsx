import { describe, expect, it } from 'vitest';
import { SESSION_STARTABLE_BUILTIN_WORKFLOWS } from './useSessionBuiltinWorkflowStart';

describe('session workflow choices', () => {
    it('offers the origin-session workflows at a start surface that has that Session', () => {
        expect(SESSION_STARTABLE_BUILTIN_WORKFLOWS.map((entry) => entry.id)).toContain('builtin:keep-going');
        expect(SESSION_STARTABLE_BUILTIN_WORKFLOWS.map((entry) => entry.id)).toContain('builtin:review-and-converge');
    });
});
