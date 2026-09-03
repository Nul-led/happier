import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveHomeSearchCapability, resolveHomeSearchRuntimeConfig } from './homeSearchCapability';

describe('Home search capability', () => {
    it('reports ready only for plain homes with a usable index', () => {
        expect(resolveHomeSearchCapability({ indexReady: true }))
            .toEqual({ enabled: true });
        expect(resolveHomeSearchCapability({ indexReady: false }))
            .toEqual({ enabled: false, reason: 'index_unavailable' });
    });

    it('does not advertise ready while initial reconciliation is still pending', () => {
        expect(resolveHomeSearchCapability({ indexReady: true, indexing: true }))
            .toEqual({ enabled: false, reason: 'indexing' });
    });

    it('admits production composition only for local SQLite plain server-light', () => {
        const eligible = {
            HAPPIER_SERVER_FLAVOR: 'light',
            HAPPIER_DB_PROVIDER: 'sqlite',
            HAPPIER_FILES_BACKEND: 'local',
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'plaintext_only',
            HAPPIER_SERVER_LIGHT_DATA_DIR: '/home-data',
        };
        expect(resolveHomeSearchRuntimeConfig(eligible)).toEqual({ dataDir: '/home-data', storagePolicy: 'plaintext_only' });
        expect(resolveHomeSearchRuntimeConfig({ ...eligible, HAPPIER_SERVER_FLAVOR: 'full' })).toBeNull();
        expect(resolveHomeSearchRuntimeConfig({ ...eligible, HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'required_e2ee' })).toBeNull();
        expect(resolveHomeSearchRuntimeConfig({ ...eligible, HAPPIER_FEATURE_SEARCH__ENABLED: '0' })).toBeNull();
    });

    it('reads the storage policy through the canonical encryption feature-env owner only', () => {
        // The canonical owner has no `HAPPY_` alias for this key and fails closed to
        // `required_e2ee`; the Home index must not index plaintext on a stricter server.
        expect(resolveHomeSearchRuntimeConfig({
            HAPPIER_SERVER_FLAVOR: 'light',
            HAPPIER_DB_PROVIDER: 'sqlite',
            HAPPIER_FILES_BACKEND: 'local',
            HAPPY_FEATURE_ENCRYPTION__STORAGE_POLICY: 'plaintext_only',
            HAPPIER_SERVER_LIGHT_DATA_DIR: '/home-data',
        })).toBeNull();
        expect(resolveHomeSearchRuntimeConfig({
            HAPPIER_SERVER_FLAVOR: 'light',
            HAPPIER_DB_PROVIDER: 'sqlite',
            HAPPIER_FILES_BACKEND: 'local',
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'plain',
            HAPPIER_SERVER_LIGHT_DATA_DIR: '/home-data',
        })).toBeNull();
    });

    it('uses the canonical light data directory default when no override is configured', () => {
        const home = join('/tmp', 'home-search-runtime-owner');
        expect(resolveHomeSearchRuntimeConfig({
            HAPPIER_SERVER_FLAVOR: 'light',
            HAPPIER_DB_PROVIDER: 'sqlite',
            HAPPIER_FILES_BACKEND: 'local',
            HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'plaintext_only',
            HOME: home,
        })).toEqual({
            dataDir: join(home, '.happy', 'server-light'),
            storagePolicy: 'plaintext_only',
        });
    });
});
