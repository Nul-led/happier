import { describe, expect, it } from 'vitest';

import { readCanonicalPluginManifest } from '@/plugins/manifest/normalize';
import { createPluginManifestV2Fixture } from '@/plugins/testkit/manifestV2Fixture';

import { hasPluginAuthorityExpansion } from './updateReviewPolicy';

const NETWORK_TARGET = Object.freeze({
    kind: 'fixedOrigin',
    origin: 'https://api.example.test',
});

/**
 * Each call parses its own manifest, so semantically identical localized
 * `{ key, fallback }` reason objects are distinct references across the
 * previous/candidate pair — exactly what an installed record and a freshly
 * parsed update candidate look like.
 */
function manifestWithLocalizedReasons(options: Readonly<{
    version: string;
    requiredReason: Readonly<{ key: string; fallback: string }>;
    optionalReason: Readonly<{ key: string; fallback: string }>;
}>) {
    const parsed = readCanonicalPluginManifest(createPluginManifestV2Fixture({
        id: 'acme.localized-reasons',
        version: options.version,
        hostAccess: {
            required: [{
                id: 'api',
                capability: 'network',
                reason: { ...options.requiredReason },
                scope: { targets: [{ ...NETWORK_TARGET }] },
            }],
            optional: [{
                id: 'sessions',
                capability: 'sessions',
                reason: { ...options.optionalReason },
                scope: { access: ['read'] },
            }],
        },
    }));
    if (!parsed) throw new Error('Expected canonical host-access manifest');
    return parsed;
}

describe('hasPluginAuthorityExpansion localized host-access reasons', () => {
    it('does not reopen review when separately parsed manifests declare the same localized reason objects', () => {
        const previous = manifestWithLocalizedReasons({
            version: '1.0.0',
            requiredReason: { key: 'acme.access.api', fallback: 'Talk to the Example API' },
            optionalReason: { key: 'acme.access.sessions', fallback: 'Read your sessions' },
        });
        const candidate = manifestWithLocalizedReasons({
            version: '1.0.1',
            requiredReason: { key: 'acme.access.api', fallback: 'Talk to the Example API' },
            optionalReason: { key: 'acme.access.sessions', fallback: 'Read your sessions' },
        });

        expect(hasPluginAuthorityExpansion(previous, candidate, [])).toBe(false);
    });

    /**
     * A reason is disclosure copy for a scope the user already approved, not
     * authority of its own: rewriting or relocalizing it reaches nothing the
     * granted scope could not already reach.
     */
    it('does not reopen review when a localized reason key or fallback is rewritten', () => {
        const previous = manifestWithLocalizedReasons({
            version: '1.0.0',
            requiredReason: { key: 'acme.access.api', fallback: 'Talk to the Example API' },
            optionalReason: { key: 'acme.access.sessions', fallback: 'Read your sessions' },
        });
        const rekeyed = manifestWithLocalizedReasons({
            version: '1.0.1',
            requiredReason: { key: 'acme.access.apiV2', fallback: 'Talk to the Example API' },
            optionalReason: { key: 'acme.access.sessions', fallback: 'Read your sessions' },
        });
        const reworded = manifestWithLocalizedReasons({
            version: '1.0.1',
            requiredReason: { key: 'acme.access.api', fallback: 'Talk to the Example API v2' },
            optionalReason: { key: 'acme.access.sessionsV2', fallback: 'Read your sessions today' },
        });

        expect(hasPluginAuthorityExpansion(previous, rekeyed, [])).toBe(false);
        expect(hasPluginAuthorityExpansion(previous, reworded, [])).toBe(false);
    });
});
