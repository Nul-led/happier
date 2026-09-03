import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../../settingsViewTestHelpers';
import type { InstalledPluginEntry } from '../model/pluginMarketplaceModel';

import { PluginDetailActionsSection } from './PluginDetailActionsSection';
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
            updatePolicy: 'reviewEveryUpdate',
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
    it('offers all three npm policies, names the exact target, and allows unpinning', async () => {
        const onSelect = vi.fn();
        const screen = await renderScreen(<PluginUpdatePolicySection
            installed={{ ...installed('npm'), install: { ...installed('npm').install, updatePolicy: 'pinned' } }}
            targetLabel={{ machine: 'Build Mac', server: 'Personal relay' }}
            disabled={false}
            onSelect={onSelect}
        />);

        expect(screen.findByTestId('settings.plugins.detail.acme.policy.updatePolicy.pinned')).toBeTruthy();
        expect(screen.findByTestId('settings.plugins.detail.acme.policy.updatePolicy.reviewSensitiveChanges')).toBeTruthy();
        expect(screen.getTextContent()).toContain('Build Mac');
        expect(screen.getTextContent()).toContain('Personal relay');

        await screen.pressByTestIdAsync(
            'settings.plugins.detail.acme.policy.updatePolicy.reviewEveryUpdate',
        );
        expect(onSelect).toHaveBeenCalledWith('reviewEveryUpdate');
    });

    it('withholds misleading sensitive-review policy from non-npm installs and disables writes without a target', async () => {
        const onSelect = vi.fn();
        const screen = await renderScreen(<PluginUpdatePolicySection
            installed={installed('localPath')}
            targetLabel={null}
            disabled
            onSelect={onSelect}
        />);

        expect(screen.findAllByTestId('settings.plugins.detail.acme.policy.updatePolicy.reviewSensitiveChanges'))
            .toHaveLength(0);
        const pinned = screen.findByTestId(
            'settings.plugins.detail.acme.policy.updatePolicy.pinned',
        );
        if (!pinned) throw new Error('Expected pinned policy row');
        expect(pinned.props.accessibilityState).toMatchObject({ disabled: true });
    });

    it('keeps the existing Update action on the detail surface with the shared action type', async () => {
        const onAction = vi.fn();
        const screen = await renderScreen(<PluginDetailActionsSection
            installed={installed('npm')}
            actionInFlight={false}
            canRunActions
            onAction={onAction}
        />);
        await screen.pressByTestIdAsync('settings.plugins.detail.acme.policy.action.update');
        expect(onAction).toHaveBeenCalledWith('update', 'acme.policy');
    });
});
