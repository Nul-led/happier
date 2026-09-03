import { describe, expect, it } from 'vitest';

import {
    BROWSER_IROH_ASSET_DIRECTORY,
    BROWSER_IROH_PACKAGED_ASSETS,
    browserIrohAssetUrl,
} from './assets';

describe('sync/runtime/browserIroh/assets', () => {
    it('names the same asset set the packaging tool produces', async () => {
        // The runtime fetches these by name and the build writes them by name.
        // A rename that lands on one side only is a silent 404 at the moment a
        // lease is first requested, which is exactly when it is hardest to see.
        const packaging = await import('../../../../tools/iroh/browserIrohAssetPackaging.mjs');

        expect([...BROWSER_IROH_PACKAGED_ASSETS]).toEqual(packaging.BROWSER_IROH_PACKAGED_ASSETS);
        expect(BROWSER_IROH_ASSET_DIRECTORY).toBe(packaging.BROWSER_IROH_ASSET_DIRECTORY);
    });

    it('resolves asset URLs against the document base rather than an absolute origin', () => {
        // The app is served from its own origin, which may be a sub-path. An
        // origin-rooted URL would break every deployment that is not at `/`.
        expect(browserIrohAssetUrl('happier-iroh-worker.js', 'https://app.happier.test/base/')).toBe(
            'https://app.happier.test/base/vendor/iroh/happier-iroh-worker.js',
        );
    });
});
