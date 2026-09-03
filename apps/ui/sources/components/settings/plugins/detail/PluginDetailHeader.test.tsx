import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';

installSettingsViewCommonModuleMocks();

describe('PluginDetailHeader', () => {
    it('exposes the plugin identity as a navigable heading', async () => {
        const { PluginDetailHeader } = await import('./PluginDetailHeader');
        const screen = await renderScreen(
            <PluginDetailHeader
                installed={{
                    pluginId: 'acme.plugin',
                    title: 'Acme plugin',
                    description: 'Example plugin',
                    version: '1.0.0',
                    enabled: true,
                    source: { kind: 'localPath', locator: '/plugins/acme.plugin', trustPolicy: 'trusted' },
                    install: { mode: 'copy', manifestVersion: '1.0.0' },
                    compatibility: { status: 'compatible', diagnostics: [] },
                    diagnostics: [],
                }}
                projection={null}
            />,
        );

        expect(screen.findAll((node) => (node.type as unknown) === 'Text' && node.props.accessibilityRole === 'header'))
            .toHaveLength(1);
        expect(screen.getTextContent()).toContain('acme.plugin');
    });

    it('omits the description row when the plugin has no description', async () => {
        const { PluginDetailHeader } = await import('./PluginDetailHeader');
        const screen = await renderScreen(
            <PluginDetailHeader
                installed={{
                    pluginId: 'acme.plugin',
                    title: 'Acme plugin',
                    description: null,
                    version: '1.0.0',
                    enabled: true,
                    source: { kind: 'localPath', locator: '/plugins/acme.plugin', trustPolicy: 'trusted' },
                    install: { mode: 'copy', manifestVersion: '1.0.0' },
                    compatibility: { status: 'compatible', diagnostics: [] },
                    diagnostics: [],
                }}
                projection={null}
            />,
        );

        expect(screen.getTextContent()).not.toContain('settingsPlugins.subtitle');
    });
});
