import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveHomeSearchCapability, resolveHomeSearchRuntimeConfig } from './homeSearchCapability';

describe('Home search capability', () => {
    it('reports ready only for plain homes with a usable index', () => {
        expect(resolveHomeSearchCapability({ storagePolicy: 'plaintext_only', indexReady: true }))
            .toEqual({ enabled: true, provider: 'home' });
        expect(resolveHomeSearchCapability({ storagePolicy: 'plain', indexReady: true }))
            .toEqual({ enabled: true, provider: 'home' });
        expect(resolveHomeSearchCapability({ storagePolicy: 'e2ee', indexReady: true }))
            .toEqual({ enabled: false, provider: 'daemon', reason: 'non_plain_home' });
        expect(resolveHomeSearchCapability({ storagePolicy: 'plaintext_only', indexReady: false }))
            .toEqual({ enabled: false, provider: 'home', reason: 'index_unavailable' });
    });

    it('does not advertise ready while initial reconciliation is still pending', () => {
        expect(resolveHomeSearchCapability({ storagePolicy: 'plaintext_only', indexReady: true, indexing: true }))
            .toEqual({ enabled: false, provider: 'home', reason: 'indexing' });
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
