import { describe, expect, it } from 'vitest';

import {
    PluginSystemToolContributionV1Schema,
    PluginSystemToolReadinessV1Schema,
} from './systemTools.js';

const READINESS = {
    acpProbeArgs: ['acp'],
    currentFingerprint: {
        loadSession: true,
        sessionCapabilities: ['list', 'resume', 'close', 'delete', 'fork'],
        absentSessionCapabilities: [],
        mcpHttp: true,
        mcpSse: true,
    },
    legacyFingerprint: {
        loadSession: true,
        sessionCapabilities: ['list', 'resume'],
        absentSessionCapabilities: ['close', 'delete', 'fork'],
        mcpHttp: true,
        mcpSse: false,
    },
    commandSurfaceArgs: ['migrate', '--help'],
    legacyExecutableNames: ['kimi-cli'],
    legacyGuidance: 'Install the current Kimi Code CLI, then run `kimi migrate` manually.',
    unidentifiedGuidance: 'Install the current Kimi Code CLI and retry.',
};

describe('PluginSystemToolReadinessV1Schema', () => {
    it('accepts a capability-fingerprint readiness declaration', () => {
        expect(PluginSystemToolReadinessV1Schema.parse(READINESS)).toMatchObject({
            commandSurfaceArgs: ['migrate', '--help'],
            legacyExecutableNames: ['kimi-cli'],
        });
    });

    it('rejects version-ordering declarations instead of ranking by semver', () => {
        expect(() => PluginSystemToolReadinessV1Schema.parse({
            ...READINESS,
            orderByVersion: true,
        })).toThrow();
        expect(() => PluginSystemToolReadinessV1Schema.parse({
            ...READINESS,
            minimumVersion: '1.0.0',
        })).toThrow();
    });

    it('requires nonempty guidance and capability expectations', () => {
        expect(() => PluginSystemToolReadinessV1Schema.parse({
            ...READINESS,
            legacyGuidance: '   ',
        })).toThrow();
        expect(() => PluginSystemToolReadinessV1Schema.parse({
            ...READINESS,
            currentFingerprint: { ...READINESS.currentFingerprint, sessionCapabilities: [] },
        })).toThrow();
    });

    it('flows through the system tool contribution shape', () => {
        const parsed = PluginSystemToolContributionV1Schema.parse({
            id: 'kimi-cli',
            title: 'Kimi Code CLI',
            executableNames: ['kimi'],
            readiness: READINESS,
        });
        expect(parsed.readiness?.legacyExecutableNames).toEqual(['kimi-cli']);
    });

    it('stays optional so unrelated tools keep plain executable resolution', () => {
        const parsed = PluginSystemToolContributionV1Schema.parse({
            id: 'plain',
            title: 'Plain',
            executableNames: ['plain'],
        });
        expect(parsed.readiness).toBeUndefined();
    });
});
