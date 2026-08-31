import { beforeEach, describe, expect, it, vi } from 'vitest';

const captureMock = vi.hoisted(() => vi.fn());

vi.mock('./tracking', () => ({
    tracking: { capture: captureMock },
}));

import { trackAuthEnrollmentTransientRetry } from './index';

describe('auth enrollment tracking', () => {
    beforeEach(() => {
        captureMock.mockReset();
    });

    it('records a transient QR retry with only fixed, secret-free labels', () => {
        trackAuthEnrollmentTransientRetry();

        expect(captureMock).toHaveBeenCalledWith('auth_enrollment_outcome', {
            flow: 'account_qr',
            outcome: 'transient_retry',
        });
    });
});
