import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildUniversalPluginUiArtifacts } from './buildUniversalUiArtifacts.js';

const firstPartyArtifactCounts = Object.freeze({
    channels: 2,
    inspector: 1,
    posthog: 2,
    'scm-azure-devops': 2,
    'scm-bitbucket': 2,
    'scm-github': 2,
    'scm-gitlab': 2,
    sentry: 2,
    triage: 5,
});

const firstPartyVoiceArtifactCounts = Object.freeze({
    codex: 1,
    elevenlabs: 1,
    openai: 1,
    xai: 1,
});

describe('first-party universal Plugin UI artifacts', () => {
    it('builds all 20 declared artifacts through the one esbuild compiler', async () => {
        const repositoryRoot = resolve(import.meta.dirname, '../../../../..');
        let total = 0;
        for (const [pluginId, expectedCount] of Object.entries(firstPartyArtifactCounts)) {
            const result = await buildUniversalPluginUiArtifacts(
                resolve(repositoryRoot, 'packages/plugins', pluginId),
            );
            expect(result.manifest.version).toBe(2);
            expect(result.manifest.entries).toHaveLength(expectedCount);
            expect(result.manifest.entries.every((entry) => (
                entry.tier === 'reactNative'
                && entry.files.length === 1
                && entry.entry.endsWith('/entry.cjs.bundle')
                && entry.builtWith.bundler === 'esbuild'
            ))).toBe(true);
            total += result.manifest.entries.length;
        }
        expect(total).toBe(20);
    }, 120_000);

    it('builds first-party client voice activation through the same compiler', async () => {
        const repositoryRoot = resolve(import.meta.dirname, '../../../../..');
        for (const [pluginId, expectedCount] of Object.entries(firstPartyVoiceArtifactCounts)) {
            const result = await buildUniversalPluginUiArtifacts(
                resolve(repositoryRoot, 'packages/plugins', pluginId),
            );
            expect(result.manifest.entries).toHaveLength(expectedCount);
            expect(result.manifest.entries[0]).toMatchObject({
                tier: 'reactNative',
                executable: { exports: ['activate'] },
            });
        }
    }, 120_000);
});
