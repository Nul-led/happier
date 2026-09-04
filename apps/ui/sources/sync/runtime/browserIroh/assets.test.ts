import { describe, expect, it } from 'vitest';

import {
    BROWSER_IROH_ASSET_DIRECTORY,
    BROWSER_IROH_PACKAGED_ASSETS,
    BROWSER_IROH_WASM_BINARY_ASSET,
    BROWSER_IROH_WASM_GLUE_ASSET,
    BROWSER_IROH_WORKER_ASSET,
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

    it('packages runtime bytes only; declaration files stay build/typecheck artifacts', () => {
        // Lane 06 amendment A9: the generated wasm-bindgen `.d.ts` files
        // describe the boundary for build/typecheck consumers in the wasm
        // build output, but nothing at runtime fetches them, so they are not
        // browser runtime assets and must not be staged or verified as one.
        expect(BROWSER_IROH_PACKAGED_ASSETS).toEqual([
            BROWSER_IROH_WORKER_ASSET,
            BROWSER_IROH_WASM_GLUE_ASSET,
            BROWSER_IROH_WASM_BINARY_ASSET,
        ]);
    });

    it('resolves asset URLs beneath a trailing-slash deployment base', () => {
        // The app may be deployed under a sub-path. An origin-rooted URL would
        // break every deployment that is not at `/`.
        expect(browserIrohAssetUrl('happier-iroh-worker.js', 'https://app.happier.test/base/')).toBe(
            'https://app.happier.test/base/vendor/iroh/happier-iroh-worker.js',
        );
    });

    it('treats a deployment base without a trailing slash as a directory, not a document', () => {
        // This is the exact shape the packaged client produces: the app origin
        // plus the configured base path (`https://origin/app`, no trailing
        // slash). URL relative resolution REPLACES a non-directory base's last
        // segment, so without normalization the `/app` deployment path is
        // silently dropped and every subpath deployment 404s the worker.
        expect(browserIrohAssetUrl('happier-iroh-worker.js', 'https://app.happier.test/app')).toBe(
            'https://app.happier.test/app/vendor/iroh/happier-iroh-worker.js',
        );
        // Root hosting: the bare origin must not lose the asset directory.
        expect(browserIrohAssetUrl('happier_iroh_wasm_bg.wasm', 'https://app.happier.test')).toBe(
            'https://app.happier.test/vendor/iroh/happier_iroh_wasm_bg.wasm',
        );
        // A deeper configured subpath resolves beneath all of its segments.
        expect(browserIrohAssetUrl('happier-iroh-worker.js', 'https://app.happier.test/apps/team')).toBe(
            'https://app.happier.test/apps/team/vendor/iroh/happier-iroh-worker.js',
        );
    });
});
