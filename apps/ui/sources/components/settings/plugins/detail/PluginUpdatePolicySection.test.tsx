import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';
import type { InstalledPluginEntry } from '../model/pluginMarketplaceModel';

import { PluginUpdatePolicySection } from './PluginUpdatePolicySection';

installSettingsViewCommonModuleMocks();

function installed(kind: 'npm' | 'localPath'): InstalledPluginEntry {
    return {
        pluginId: 'acme.policy',
        title: 'Policy plugin',
        description: null,
        version: '1.0.0',
        enabled: true,
        source: {
            kind: kind === 'npm' ? 'npm' : 'path',
            locator: kind === 'npm' ? '@acme/policy' : '/tmp/acme-policy',
            trustPolicy: 'prompt',
        },
        install: {
            mode: kind === 'npm' ? 'managed_install' : 'link',
            manifestVersion: '1.0.0',
            updatePolicy: 'allowed',
            trust: {
                pluginId: 'acme.policy',
                state: 'trusted',
                approvedAtMs: 1,
                distribution: kind === 'npm'
                    ? {
                        kind: 'npm',
                        registryOrigin: 'https://registry.npmjs.org',
                        packageName: '@acme/policy',
                    }
                    : { kind: 'localPath', canonicalPath: '/tmp/acme-policy' },
            },
        },
        compatibility: { status: 'compatible', diagnostics: [] },
        diagnostics: [],
    };
}

describe('PluginUpdatePolicySection', () => {
    it('offers both policies side by side, names the exact target, and allows unpinning', async () => {
        const onSelect = vi.fn();
        const screen = await renderScreen(<PluginUpdatePolicySection
            installed={{ ...installed('npm'), install: { ...installed('npm').install, updatePolicy: 'pinned' } }}
            targetLabel={{ machine: 'Build Mac', server: 'Personal relay' }}
            disabled={false}
            onSelect={onSelect}
        />);

        expect(screen.findByTestId('settings.plugins.detail.acme.policy.updatePolicy:pinned')).toBeTruthy();
        expect(screen.findByTestId('settings.plugins.detail.acme.policy.updatePolicy:allowed')).toBeTruthy();
        expect(screen.getTextContent()).toContain('Build Mac');
        expect(screen.getTextContent()).toContain('Personal relay');

        await screen.pressByTestIdAsync('settings.plugins.detail.acme.policy.updatePolicy:allowed');
        expect(onSelect).toHaveBeenCalledWith('allowed');
    });

    it('does not write the policy that is already in force, and disables writes without a target', async () => {
        const onSelect = vi.fn();
        const screen = await renderScreen(<PluginUpdatePolicySection
            installed={installed('localPath')}
            targetLabel={null}
            disabled
            onSelect={onSelect}
        />);

        const row = screen.findAll((node) => node.props?.testID === 'settings.plugins.detail.acme.policy.updatePolicy'
            && node.props.disabled === true);
        expect(row.length).toBeGreaterThan(0);
        await screen.pressByTestIdAsync('settings.plugins.detail.acme.policy.updatePolicy:allowed').catch(() => undefined);
        expect(onSelect).not.toHaveBeenCalled();
    });
});
