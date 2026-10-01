import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';
import type { PluginMarketplaceDiscoverSourceStatus } from './readPluginMarketplaceCatalog';

installSettingsViewCommonModuleMocks();

const unreachable: PluginMarketplaceDiscoverSourceStatus = {
    id: 'happier-curated',
    title: 'Happier curated marketplace',
    kind: 'curated',
    freshness: 'unavailable',
    diagnostics: [{
        id: 'source:happier-curated:marketplace_source_unavailable:0',
        sourceId: 'happier-curated',
        sourceTitle: 'Happier curated marketplace',
        code: 'marketplace_source_unavailable',
        message: 'getaddrinfo ENOTFOUND marketplace.happier.dev',
    }],
};

/** Browse with one marketplace source that did not answer. */
describe('Browse source issues', () => {
    afterEach(standardCleanup);

    it('shows one notice per source and keeps the technical detail behind Details', async () => {
        const { DiscoverStatusSummary } = await import('./PluginMarketplaceSections');
        const screen = await renderScreen(<DiscoverStatusSummary loading={false} error={null} stale={false} entryCount={3}
            sourceStatuses={[unreachable]} diagnostics={[]} nonInstallable={[]} selectedSourceTitle={null}
            onRetry={() => {}} onOpenSources={() => {}} />);
        const notices = new Set(screen.findAll((node) => typeof node.props.testID === 'string'
            && /^settings\.plugins\.marketplace\.discover\.issue\.[^.]+$/.test(node.props.testID))
            .map((node) => node.props.testID as string));
        expect([...notices]).toEqual(['settings.plugins.marketplace.discover.issue.happier-curated']);
        const before = screen.getTextContent();
        expect(before).toContain('settingsPlugins.discover.diagnostic.unreachableTitle');
        expect(before).not.toContain('getaddrinfo ENOTFOUND');
        expect(before).not.toContain('settingsPlugins.diagnosticsTechnicalCode');
        await screen.pressByTestIdAsync('settings.plugins.marketplace.discover.issue.happier-curated.details');
        const after = screen.getTextContent();
        expect(after).toContain('getaddrinfo ENOTFOUND marketplace.happier.dev');
        expect(after).toContain('settingsPlugins.diagnosticsTechnicalCode');
    });
});
