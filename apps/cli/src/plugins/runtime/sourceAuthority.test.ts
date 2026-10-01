import { describe, expect, it } from 'vitest';

import {
    bindPluginRuntimeSourceAuthority,
    normalizePluginSourceCustody,
    resolvePluginSourceCustody,
} from './sourceAuthority';

describe('plugin source authority', () => {
    it.each([
        {
            kind: 'managed',
            immutableGenerationId: 'generation-a',
            installSource: 'npm',
        },
        {
            kind: 'bundled_first_party',
            packagedRuntime: {
                kind: 'cli_version_root',
                versionRootId: 'versions/0.3.0',
            },
        },
        {
            kind: 'bundled_first_party',
            packagedRuntime: {
                kind: 'pinned_runner_snapshot',
                snapshotId: 'runner-snapshot-a',
            },
        },
        {
            kind: 'development',
            registeredRootId: 'development-root-a',
        },
    ] as const)('normalizes the $kind durable custody arm', (custody) => {
        expect(normalizePluginSourceCustody(custody)).toEqual(custody);
    });

    it('rejects immutable-generation identity on bundled and development custody', () => {
        expect(() => normalizePluginSourceCustody({
            kind: 'bundled_first_party',
            packagedRuntime: {
                kind: 'cli_version_root',
                versionRootId: 'versions/0.3.0',
            },
            immutableGenerationId: 'forbidden',
        })).toThrow();
        expect(() => normalizePluginSourceCustody({
            kind: 'development',
            registeredRootId: 'development-root-a',
            immutableGenerationId: 'forbidden',
        })).toThrow();
    });

    it('binds runtime-only roots and revisions without changing durable custody', () => {
        const custody = normalizePluginSourceCustody({
            kind: 'development',
            registeredRootId: 'development-root-a',
        });
        const authority = bindPluginRuntimeSourceAuthority({
            custody,
            resolvedRoot: '/workspace/plugin-a',
            observedRevision: 7,
        });

        expect(authority).toEqual({
            kind: 'development',
            registeredRootId: 'development-root-a',
            canonicalRoot: '/workspace/plugin-a',
            observedRevision: 7,
        });
        expect(resolvePluginSourceCustody(authority)).toEqual(custody);
        expect(resolvePluginSourceCustody(authority)).not.toHaveProperty('resolvedRoot');
        expect(resolvePluginSourceCustody(authority)).not.toHaveProperty('observedRevision');
    });
});
