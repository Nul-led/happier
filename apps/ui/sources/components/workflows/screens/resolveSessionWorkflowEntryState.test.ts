import { describe, expect, it } from 'vitest';

import type { SessionRouteHydrationState } from '@/sync/domains/session/sessionRouteHydrationState';

import { resolveSessionWorkflowEntryState } from './resolveSessionWorkflowEntryState';

const sessionId = 'session-1';

describe('resolveSessionWorkflowEntryState', () => {
    it('reports waiting while the canonical hydration owner is still working', () => {
        for (const reason of ['cold', 'server-switch', 'store-miss', 'refreshing'] as const) {
            const hydration: SessionRouteHydrationState = { kind: 'loading', sessionId, reason };
            expect(resolveSessionWorkflowEntryState({ hydration, hasSession: false })).toBe('loading');
        }
    });

    it('separates a Session that is gone from one this device may not read', () => {
        expect(resolveSessionWorkflowEntryState({
            hydration: { kind: 'missing', sessionId, cause: 'not_found' },
            hasSession: false,
        })).toBe('missing');

        // An expired or refused authorization says nothing about whether the
        // Session still exists, so it must not be reported as deleted.
        for (const cause of ['unauthorized', 'forbidden', 'auth_unavailable'] as const) {
            expect(resolveSessionWorkflowEntryState({
                hydration: { kind: 'missing', sessionId, cause },
                hasSession: false,
            })).toBe('inaccessible');
        }
    });

    it('reports a retryable transport failure as failed rather than missing or loading', () => {
        for (const cause of ['network', 'server_unavailable', 'decrypting', 'unknown'] as const) {
            expect(resolveSessionWorkflowEntryState({
                hydration: { kind: 'retrying', sessionId, cause },
                hasSession: false,
            })).toBe('failed');
        }
    });

    it('keeps waiting when hydration succeeded before the Session snapshot landed', () => {
        expect(resolveSessionWorkflowEntryState({
            hydration: { kind: 'available', sessionId },
            hasSession: false,
        })).toBe('loading');
    });

    it('reports an unusable context only for a Session that is actually readable', () => {
        expect(resolveSessionWorkflowEntryState({
            hydration: { kind: 'available', sessionId },
            hasSession: true,
        })).toBe('unsupported');
    });
});
