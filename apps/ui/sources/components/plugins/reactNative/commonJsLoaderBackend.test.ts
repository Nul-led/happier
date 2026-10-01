import { describe, expect, it } from 'vitest';

import { createPluginUiCommonJsLoaderBackend } from './commonJsLoaderBackend';

const bytes = new TextEncoder().encode('exports.renderSurface = () => "universal";');

describe('createPluginUiCommonJsLoaderBackend', () => {
    it.each(['web', 'ios', 'android'] as const)(
        'evaluates the same universal CommonJS artifact on %s',
        async (platform) => {
            const backend = createPluginUiCommonJsLoaderBackend();
            const exported = await backend.loadInstalledBundle?.({
                identity: {
                    pluginId: 'example.universal',
                    contributionId: 'main-renderer',
                    artifactId: 'main-renderer',
                    artifactDigest: 'sha256:universal',
                    platform,
                },
                bytes,
                moduleReference: { exportName: 'renderSurface' },
            });

            expect(exported).toBeTypeOf('function');
            expect(exported?.()).toBe('universal');
        },
    );
});
