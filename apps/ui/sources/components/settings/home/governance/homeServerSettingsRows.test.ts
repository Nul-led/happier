import { describe, expect, it } from 'vitest';
import type { HomeSettingEntryV1 } from '@happier-dev/protocol/home/governance';

import { homeSettingEntryFixture, homeSettingsProjectionFixture } from '@/dev/testkit/fixtures/homeGovernanceFixtures';

import { filterHomeServerSettings, selectHomeServerSettings } from './homeServerSettingsRows';

const entry = (key: string, declaration: NonNullable<HomeSettingEntryV1['declaration']>, overrides?: Partial<HomeSettingEntryV1>) =>
    homeSettingEntryFixture(key, { declaration, ...overrides });

describe('selectHomeServerSettings', () => {
    it('takes every key no bespoke page edits, and leaves the rest to their pages', () => {
        const layout = selectHomeServerSettings(homeSettingsProjectionFixture({
            entries: [
                entry('PORT', { type: 'int', section: 'server', group: 'process' }),
                entry('HAPPIER_SERVER_UI_DIR', { type: 'string', section: 'server', group: 'ui' }),
                entry('HAPPIER_SESSION_MESSAGES_RATE_LIMIT_MAX', { type: 'int', section: 'server', family: 'rateLimits' }),
                entry('HAPPIER_API_RATE_LIMITS_GLOBAL_MAX', { type: 'int', section: 'server', family: 'rateLimits' }),
                entry('GITHUB_CLIENT_ID', { type: 'string', section: 'policies', group: 'github' }),
                entry('HAPPIER_WEBAPP_OAUTH_RETURN_URL_BASE', { type: 'url', section: 'reach', group: 'addresses' }),
                // Owned by Policies, Reach, Email, Features and Data.
                entry('AUTH_SIGNUP_PROVIDERS', { type: 'list', section: 'policies', group: 'signup' }),
                entry('HAPPIER_PUBLIC_SERVER_URL', { type: 'url', section: 'reach', group: 'addresses' }),
                entry('HAPPIER_AUTH_EMAIL_SMTP_HOST', { type: 'string', section: 'email' }),
                entry('HAPPIER_FEATURE_VOICE__ENABLED', { type: 'boolean', section: 'features', featureId: 'voice' }),
                // Read-only, wherever it is declared.
                entry('HAPPIER_CANONICAL_SERVER_URL', { type: 'url', section: 'reach', group: 'addresses' }, { editable: 'bootstrap' }),
            ],
        }));
        const keysOf = (groups: typeof layout.primary) => Object.fromEntries(groups.map((group) => [group.id, group.entries.map((row) => row.key)]));

        expect(keysOf(layout.primary)).toEqual({ api: ['PORT', 'HAPPIER_API_RATE_LIMITS_GLOBAL_MAX'] });
        expect(keysOf(layout.more)).toEqual({
            ui: ['HAPPIER_SERVER_UI_DIR'],
            rateLimits: ['HAPPIER_SESSION_MESSAGES_RATE_LIMIT_MAX'],
            github: ['GITHUB_CLIENT_ID'],
            addresses: ['HAPPIER_WEBAPP_OAUTH_RETURN_URL_BASE'],
        });
        expect(layout.readOnly.map((row) => row.key)).toEqual(['HAPPIER_CANONICAL_SERVER_URL']);
    });

    it('counts pending and ignored from the projection, across every page, and filters to changed rows', () => {
        const layout = selectHomeServerSettings(homeSettingsProjectionFixture({
            entries: [
                entry('METRICS_PORT', { type: 'int', section: 'server', group: 'monitoring' }, {
                    value: 9191, source: 'home', apply: 'restart', applied: { value: 9090, pending: true },
                }),
                entry('PORT', { type: 'int', section: 'server', group: 'process' }),
                entry('HAPPIER_FEATURE_SEARCH__ENABLED', { type: 'boolean', section: 'features', featureId: 'search' }, {
                    value: false, source: 'home', apply: 'restart', applied: { value: true, pending: true, ignoredReason: 'invalid_type' },
                }),
            ],
        }));

        expect(layout.pending.map((row) => row.key)).toEqual(['METRICS_PORT', 'HAPPIER_FEATURE_SEARCH__ENABLED']);
        expect(layout.ignored.map((row) => row.key)).toEqual(['HAPPIER_FEATURE_SEARCH__ENABLED']);
        expect(layout.changedCount).toBe(1);
        const changed = filterHomeServerSettings(layout, { query: '', changedOnly: true });
        expect(changed.primary.flatMap((group) => group.entries.map((row) => row.key))).toEqual(['METRICS_PORT']);
        const search = filterHomeServerSettings(layout, { query: 'port', changedOnly: false });
        expect(search.primary.flatMap((group) => group.entries.map((row) => row.key)).sort()).toEqual(['METRICS_PORT', 'PORT']);
    });
});
