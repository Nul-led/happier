import { describe, expect, it } from 'vitest';

import type { ServerFetch } from '@/sync/http/client';
import { HappyError } from '@/utils/errors/errors';
import { changeAccountPassword, changeAccountSignInEmail, fetchAccountSecurity } from './accountSecurity';

const input = { expectedCredentialRevision: 4, currentPassword: 'current password', newPassword: 'replacement password' };

describe('Account Security mutation transport settlement', () => {
    it.each([false, true])('classifies transport loss from the canonical issued witness: %s', async (issued) => {
        // HTTP is the system boundary; the mutation adapter and classifier stay real.
        const failure = new TypeError('Network request failed');
        const request: ServerFetch = async (_path, _init, options) => {
            if (issued) options?.onIssued?.();
            throw failure;
        };
        if (issued) {
            await expect(changeAccountPassword(request, input)).rejects.toMatchObject({ code: 'outcome_unknown' });
        } else {
            await expect(changeAccountPassword(request, input)).rejects.toBe(failure);
        }
    });

    it('preserves a known Home refusal after issue', async () => {
        const request: ServerFetch = async (_path, _init, options) => {
            options?.onIssued?.();
            return Response.json({ error: 'credential_revision_conflict' }, { status: 409 });
        };
        await expect(changeAccountPassword(request, input)).rejects.toMatchObject({
            code: 'credential_revision_conflict', status: 409,
        });
    });

    it('keeps a malformed successful mutation acknowledgement uncertain', async () => {
        const request: ServerFetch = async (_path, _init, options) => {
            options?.onIssued?.();
            return Response.json({ v: 1, status: 'not-a-verdict' });
        };
        await expect(changeAccountPassword(request, input)).rejects.toMatchObject({ code: 'outcome_unknown' });
    });

    it.each([
        [502, '<html>proxy unavailable</html>'],
        [500, '{"error":"internal_server_error"}'],
        [200, '{'],
    ])('keeps a lost mutation verdict uncertain for HTTP %s', async (status, body) => {
        const request: ServerFetch = async (_path, _init, options) => {
            options?.onIssued?.();
            return new Response(body, { status });
        };
        await expect(changeAccountPassword(request, input)).rejects.toMatchObject({ code: 'outcome_unknown' });
    });

    it('does not treat a failed projection read as a mutation', async () => {
        const failure = new HappyError('unavailable', true, { kind: 'server', status: 503 });
        const request: ServerFetch = async (_path, _init, options) => {
            options?.onIssued?.();
            throw failure;
        };
        await expect(fetchAccountSecurity(request)).rejects.toBe(failure);
    });

    it('keeps sign-in email completion uncertain after its acknowledgement is lost', async () => {
        const request: ServerFetch = async (_path, _init, options) => {
            options?.onIssued?.();
            throw new TypeError('Network request failed');
        };
        await expect(changeAccountSignInEmail(request, { verificationToken: 'verification-token' }))
            .rejects.toMatchObject({ code: 'outcome_unknown' });
    });

    it('does not issue a cancelled mutation', async () => {
        const controller = new AbortController();
        controller.abort();
        let requested = false;
        const request: ServerFetch = async () => { requested = true; return Response.json({ v: 1, status: 'updated' }); };
        await expect(changeAccountPassword(request, input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(requested).toBe(false);
    });
});
