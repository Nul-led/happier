import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { db } from '@/storage/db';
import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';
import { withAuthenticatedTestApp } from '@/app/api/testkit/sqliteFastify';

const sentryCaptureException = vi.hoisted(() => vi.fn());

// Sentry is the genuine external diagnostics boundary. Keep the server's
// capture/redaction owner real so these route tests exercise the same path as
// production while observing only the final outward report.
vi.mock('@sentry/node', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@sentry/node')>();
    return {
        ...actual,
        getClient: () => ({}),
        withScope: (run: (scope: Readonly<{
            setTag: (key: string, value: string) => void;
            setExtra: (key: string, value: unknown) => void;
            setUser: (user: Readonly<{ id: string }>) => void;
        }>) => void) => run({
            setTag: vi.fn(),
            setExtra: vi.fn(),
            setUser: vi.fn(),
        }),
        captureException: sentryCaptureException,
    };
});

import { registerAuthEntryRoute } from './registerAuthEntryRoute';
import { featuresRoutes } from '../features/featuresRoutes';

describe('public auth policy degradation', () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: 'happier-auth-policy-degradation-',
            initAuth: true,
            env: { AUTH_REQUIRED_LOGIN_PROVIDERS: '' },
        });
    }, 180_000);

    afterEach(() => {
        sentryCaptureException.mockClear();
        harness.restoreEnv();
    });

    afterAll(async () => {
        await harness.close();
    });

    async function withUnavailablePolicyStore(run: () => Promise<void>): Promise<void> {
        const originalTransaction = db.$transaction;
        db.$transaction = (async () => {
            throw new Error('database unavailable');
        }) as typeof db.$transaction;
        try {
            await run();
        } finally {
            db.$transaction = originalTransaction;
        }
    }

    it('keeps Home auth entry available and reports the degraded read through the diagnostics owner', async () => {
        await withUnavailablePolicyStore(async () => {
            await withAuthenticatedTestApp(
                (app) => registerAuthEntryRoute(app, { isEmailDeliveryReady: () => true }),
                async (app) => {
                    const response = await app.inject({
                        method: 'POST',
                        url: '/v1/auth/entry',
                        payload: { v: 1, scope: { kind: 'home' }, purpose: 'home' },
                    });

                    expect(response.statusCode, response.body).toBe(200);
                    expect(response.json()).toMatchObject({
                        state: 'unavailable',
                        scope: { kind: 'home' },
                        reason: 'authentication_policy_unavailable',
                    });
                    expect(sentryCaptureException).toHaveBeenCalledOnce();
                },
            );
        });
    });

    it('keeps public features available and reports the degraded read through the diagnostics owner', async () => {
        await withUnavailablePolicyStore(async () => {
            await withAuthenticatedTestApp(
                (app) => featuresRoutes(app),
                async (app) => {
                    const response = await app.inject({ method: 'GET', url: '/v1/features' });

                    expect(response.statusCode, response.body).toBe(200);
                    expect(response.json().capabilities.auth).not.toHaveProperty('methods');
                    expect(sentryCaptureException).toHaveBeenCalledOnce();
                },
            );
        });
    });
});
