import { describe, expect, it } from 'vitest';

import {
    SCM_LOG_QUERY_MAX_LENGTH,
    ScmLogListRequestSchema,
    ScmLogListResponseSchema,
} from './index.js';

/**
 * `scm.log.list` bounded-query expansion (Universal Search US-05).
 *
 * Compatibility shape:
 * - the request gains one bounded optional `query` field (additive-open; older daemons
 *   ignore it) and the response gains one optional `queryApplied` echo so a client can
 *   distinguish "the daemon searched" from "the daemon ignored the query and returned a
 *   recent page". Absence of the echo is the unsupported signal; it can never falsely
 *   report a successful search.
 * - every shape shipped before this expansion must keep parsing unchanged.
 */
describe('ScmLogList wire contract with bounded commit query', () => {
    it('accepts the legacy request/response shape without any query field', () => {
        const request = ScmLogListRequestSchema.parse({ cwd: '/repo', limit: 50, skip: 0 });
        expect(request.cwd).toBe('/repo');

        const response = ScmLogListResponseSchema.parse({ success: true, entries: [] });
        expect(response.success).toBe(true);
        expect(response.queryApplied).toBeUndefined();
    });

    it('accepts a bounded query on the request and echoes queryApplied on the response', () => {
        const request = ScmLogListRequestSchema.parse({ cwd: '/repo', limit: 20, query: 'fix login' });
        expect(request.query).toBe('fix login');

        const response = ScmLogListResponseSchema.parse({ success: true, entries: [], queryApplied: true });
        expect(response.queryApplied).toBe(true);
    });

    it('rejects a query beyond the published bound', () => {
        const tooLong = 'a'.repeat(SCM_LOG_QUERY_MAX_LENGTH + 1);
        expect(ScmLogListRequestSchema.safeParse({ cwd: '/repo', query: tooLong }).success).toBe(false);
        expect(SCM_LOG_QUERY_MAX_LENGTH).toBeGreaterThan(0);
    });

    it('accepts a query exactly at the published bound', () => {
        const atBound = 'a'.repeat(SCM_LOG_QUERY_MAX_LENGTH);
        expect(ScmLogListRequestSchema.safeParse({ cwd: '/repo', query: atBound }).success).toBe(true);
    });
});
