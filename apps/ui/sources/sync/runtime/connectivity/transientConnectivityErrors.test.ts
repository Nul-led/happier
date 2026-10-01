import { describe, expect, it } from 'vitest';

import { HappyError } from '@/utils/errors/errors';
import { isExplicitlyRetryableError, isTransientConnectivityError, shouldRetryError } from './transientConnectivityErrors';

describe('connectivity retry policy', () => {
    it('recognizes native fetch failure at the shared owner', () => {
        expect(isTransientConnectivityError(new TypeError('Network request failed'))).toBe(true);
    });

    it('keeps explicit endpoint-offline and terminal auth failures terminal', () => {
        expect(shouldRetryError(new HappyError('offline', true, { kind: 'network', code: 'endpoint_offline' }))).toBe(false);
        expect(shouldRetryError(new HappyError('auth', false, { kind: 'auth', code: 'not_authenticated' }))).toBe(false);
    });

    it('does not treat a non-network TypeError as a retryable transport failure', () => {
        expect(isExplicitlyRetryableError(new TypeError('Invalid URL'))).toBe(false);
        expect(isExplicitlyRetryableError(new TypeError('Network request failed'))).toBe(true);
        expect(isExplicitlyRetryableError(new HappyError('temporarily unavailable', true, { kind: 'server' }))).toBe(true);
    });
});
