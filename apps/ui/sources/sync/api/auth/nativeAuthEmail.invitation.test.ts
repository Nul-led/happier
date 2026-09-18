import { afterEach, expect, it, vi } from 'vitest';
import { HappyError } from '@/utils/errors/errors';

import {
    clearNativeInvitationEmailVerificationContinuation,
    readNativeInvitationEmailVerificationContinuation,
    rememberNativeInvitationEmailVerificationContinuation,
    requestNativeEmailVerification,
} from './nativeAuthEmail';

const admission = Object.freeze({
    kind: 'team_invitation' as const,
    token: 'A'.repeat(43),
});

afterEach(() => {
    clearNativeInvitationEmailVerificationContinuation(admission);
});

it('sends the exact invitation admission through the neutral native verification request', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 }));

    await requestNativeEmailVerification(request, {
        email: 'person@example.test',
        admission,
    });

    expect(request).toHaveBeenCalledWith(
        '/v1/auth/email/verify/request',
        expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
                v: 1,
                email: 'person@example.test',
                admission,
            }),
        }),
        { includeAuth: false, retry: 'none' },
    );
});

it('releases the exact process-local invitation continuation only to its matching Home mailbox landing', () => {
    rememberNativeInvitationEmailVerificationContinuation({
        homeServerIdentityId: 'home-a',
        normalizedEmail: 'person@example.test',
        admission,
    });

    expect(readNativeInvitationEmailVerificationContinuation({
        homeServerIdentityId: 'home-b',
        maskedDestination: 'p•••••@example.test',
    })).toBeNull();
    expect(readNativeInvitationEmailVerificationContinuation({
        homeServerIdentityId: 'home-a',
        maskedDestination: 'o••••@example.test',
    })).toBeNull();
    expect(readNativeInvitationEmailVerificationContinuation({
        homeServerIdentityId: 'home-a',
        maskedDestination: 'p•••••@example.test',
    })).toEqual({
        homeServerIdentityId: 'home-a',
        normalizedEmail: 'person@example.test',
        admission,
    });
});


it.each([404, 405, 501])('reports an unsupported native-auth operation as update-required without retrying (%s)', async (status) => {
    const request = vi.fn(async () => new Response(null, { status }));

    await expect(requestNativeEmailVerification(request, {
        email: 'person@example.test',
    })).rejects.toMatchObject<Partial<HappyError>>({
        name: 'HappyError',
        canTryAgain: false,
        status,
        code: 'client_update_required',
    });

    expect(request).toHaveBeenCalledTimes(1);
});
