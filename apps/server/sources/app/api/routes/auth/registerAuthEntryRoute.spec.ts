import { describe, expect, it, vi } from 'vitest';

import type { RequestPrincipalVerification } from '@/app/api/utils/verifyRequestPrincipal';

const resolveAuthEntry = vi.hoisted(() => vi.fn(async () => ({
    v: 1,
    state: 'ready' as const,
    scope: { kind: 'home' as const },
    actions: [],
    autoRedirect: null,
})));
const verifyRequestPrincipal = vi.hoisted(() => vi.fn<
    (input: unknown) => Promise<RequestPrincipalVerification>
>(async () => ({ status: 'absent' })));

vi.mock('@/app/auth/entry/resolveAuthEntry', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/app/auth/entry/resolveAuthEntry')>(),
    resolveAuthEntry,
}));
vi.mock('@/app/api/utils/verifyRequestPrincipal', () => ({ verifyRequestPrincipal }));

import { registerAuthEntryRoute } from './registerAuthEntryRoute';

function verified(
    kind: string,
    authority: 'present_user' | 'account_automation' | 'session_runtime' = 'present_user',
): RequestPrincipalVerification {
    return {
        status: 'verified',
        principal: {
            accountId: 'account-1',
            kind: kind as never,
            authority,
            legacy: false,
            apiTokenPrincipal: null,
            sessionRuntimePrincipal: null,
        },
    };
}

function mountAuthEntryRoute() {
    let handler: ((request: any, reply: any) => Promise<unknown>) | undefined;
    const app = {
        log: { error: vi.fn() },
        post: vi.fn((path: string, _options: unknown, next: typeof handler) => {
            expect(path).toBe('/v1/auth/entry');
            handler = next;
        }),
    } as any;
    registerAuthEntryRoute(app);
    const header = vi.fn();
    let statusCode = 200;
    const code = vi.fn((nextStatusCode: number) => {
        statusCode = nextStatusCode;
        return { code, header, send };
    });
    const send = vi.fn(async (value) => value);
    return {
        header,
        get statusCode() {
            return statusCode;
        },
        call: async (
            headers: Record<string, string> = {},
            body: Record<string, unknown> = { v: 1, scope: { kind: 'team', teamId: 'team-1' } },
        ) => await handler?.(
            { body, headers, ip: '203.0.113.9' },
            { code, header, send },
        ),
    };
}

describe('registerAuthEntryRoute', () => {
    it('registers a public POST endpoint and disables response caching', async () => {
        resolveAuthEntry.mockClear();
        verifyRequestPrincipal.mockResolvedValue({ status: 'absent' });
        const route = mountAuthEntryRoute();

        await expect(route.call()).resolves.toMatchObject({ state: 'ready' });
        expect(route.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(resolveAuthEntry).toHaveBeenCalledWith(
            { v: 1, scope: { kind: 'team', teamId: 'team-1' } },
            expect.objectContaining({ principal: null }),
        );
    });

    it('attributes the requesting address so the public-signup provisioning restriction applies', async () => {
        resolveAuthEntry.mockClear();
        verifyRequestPrincipal.mockResolvedValue({ status: 'absent' });
        const route = mountAuthEntryRoute();

        await route.call();

        expect(resolveAuthEntry).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ requestIp: '203.0.113.9' }),
        );
    });

    it('passes only an ordinary present-user credential into the projection', async () => {
        resolveAuthEntry.mockClear();
        verifyRequestPrincipal.mockResolvedValue(verified('account'));
        const route = mountAuthEntryRoute();

        await route.call({ authorization: 'Bearer ordinary' });

        expect(verifyRequestPrincipal).toHaveBeenCalledWith(expect.objectContaining({
            authorizationHeader: 'Bearer ordinary',
        }));
        expect(resolveAuthEntry).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ principal: { accountId: 'account-1' } }),
        );
    });

    it('keeps restricted, ineligible and unverifiable credentials anonymous', async () => {
        const anonymousVerifications: readonly RequestPrincipalVerification[] = [
            verified('api_token'),
            verified('account_directory'),
            verified('account', 'account_automation'),
            { status: 'invalid' },
            {
                status: 'ineligible',
                eligibility: { ok: false, statusCode: 403, error: 'not-eligible' },
            },
        ];

        for (const verification of anonymousVerifications) {
            resolveAuthEntry.mockClear();
            verifyRequestPrincipal.mockResolvedValue(verification);
            const route = mountAuthEntryRoute();

            await route.call({ authorization: 'Bearer restricted' });

            expect(resolveAuthEntry).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({ principal: null }),
            );
        }
    });

    it('rejects a verified Runner bearer before resolving public authentication entry', async () => {
        resolveAuthEntry.mockClear();
        verifyRequestPrincipal.mockResolvedValue(verified('ephemeral_session_runner', 'session_runtime'));
        const route = mountAuthEntryRoute();

        await route.call({ authorization: 'Bearer runner' });

        expect(route.statusCode).toBe(403);
        expect(resolveAuthEntry).not.toHaveBeenCalled();
    });

    it('rejects a cryptographically verified Runner bearer after its runtime scope is revoked', async () => {
        resolveAuthEntry.mockClear();
        verifyRequestPrincipal.mockResolvedValue({
            status: 'rejected_restricted',
            kind: 'ephemeral_session_runner',
        });
        const route = mountAuthEntryRoute();

        await route.call({ authorization: 'Bearer revoked-runner' });

        expect(route.statusCode).toBe(403);
        expect(resolveAuthEntry).not.toHaveBeenCalled();
    });
});
