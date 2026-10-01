import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createLightSqliteHarness, type LightSqliteHarness } from '@/testkit/lightSqliteHarness';

import { createRouteTestBuilder } from '../../testkit/routeTestBuilder';
import { featuresRoutes } from './featuresRoutes';

// The route reads the Home's effective rules (deployment env over the Home settings row), so it
// runs against a real database.
let harness: LightSqliteHarness;

beforeAll(async () => {
    harness = await createLightSqliteHarness({
        tempDirPrefix: 'happier-retention-policy-route-',
        initAuth: false,
        initEncrypt: true,
        initFiles: false,
    });
}, 120_000);
afterAll(async () => await harness?.close());

describe('GET /v2/retention-policy', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('reports dev-only and predecessor retention domains through a complete extensible payload', async () => {
        vi.stubEnv('HAPPIER_SERVER_RETENTION__ENABLED', '1');
        vi.stubEnv('HAPPIER_SERVER_RETENTION__SESSION_SIDECHAIN_MESSAGES__MODE', 'delete_older_than');
        vi.stubEnv('HAPPIER_SERVER_RETENTION__SESSION_SIDECHAIN_MESSAGES__DAYS', '7');
        vi.stubEnv('HAPPIER_SERVER_RETENTION__USAGE_EVENTS__MODE', 'delete_older_than');
        vi.stubEnv('HAPPIER_SERVER_RETENTION__USAGE_EVENTS__DAYS', '180');

        const route = createRouteTestBuilder({
            method: 'GET',
            path: '/v2/retention-policy',
            registerRoutes(app) {
                featuresRoutes(app as any);
            },
        });
        const { response } = await route.invoke();

        expect(response).toMatchObject({ version: 2, enabled: true, complete: true });
        expect((response as any).domains).toEqual(expect.arrayContaining([
            { id: 'sessionSidechainMessages', policy: { mode: 'delete_older_than', days: 7 } },
            { id: 'usageEvents', policy: { mode: 'delete_older_than', days: 180 } },
        ]));
    });
});
