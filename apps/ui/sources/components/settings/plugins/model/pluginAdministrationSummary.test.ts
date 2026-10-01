import { describe, expect, it } from 'vitest';

import { createPluginInstallationReviewFixture } from '@happier-dev/protocol/testing/pluginInstallationReviewFixture';

import { summarizePluginAdministration } from './pluginAdministrationSummary';

function loaded(data: Record<string, unknown>) {
    return {
        status: 'loaded' as const,
        snapshot: {
            response: {
                protocolVersion: 1 as const,
                results: { 'tool.plugins': { ok: true as const, checkedAt: 1, data } },
            },
        },
    } as never;
}

const bundled = { pluginId: 'happier.triage', source: { kind: 'bundled' } };
const userInstalled = { pluginId: 'acme.linear', source: { kind: 'marketplace' } };
const applying = { kind: 'applying', pendingChangeId: 'p-1' };
const awaiting = {
    kind: 'reviewRequired', reviewKind: 'installation', reason: 'firstInstall', currentVersion: null,
    authorityExpansion: [], pendingChangeId: 'p-2', review: createPluginInstallationReviewFixture(),
};

describe('summarizePluginAdministration', () => {
    it('counts the changes waiting for a decision and the plugins the person installed', () => {
        expect(summarizePluginAdministration(loaded({
            installedPlugins: [bundled, userInstalled],
            pendingChanges: [applying, awaiting],
        }))).toEqual({ known: true, awaitingDecision: 1, userInstalled: 1 });
    });

    it('says nothing is known without a daemon answer, rather than "none"', () => {
        expect(summarizePluginAdministration(null)).toEqual({ known: false, awaitingDecision: 0, userInstalled: 0 });
        expect(summarizePluginAdministration({ status: 'idle' } as never)).toEqual({ known: false, awaitingDecision: 0, userInstalled: 0 });
    });

    it('treats a machine with only bundled plugins as having none installed', () => {
        expect(summarizePluginAdministration(loaded({ installedPlugins: [bundled], pendingChanges: [] })))
            .toEqual({ known: true, awaitingDecision: 0, userInstalled: 0 });
    });
});
