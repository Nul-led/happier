import { describe, expect, it } from 'vitest';

import {
    canRenderPluginUiProjectionEntry,
} from './policy';

describe('plugin UI projection policy', () => {
    it('fails closed for missing projection entries', () => {
        expect(canRenderPluginUiProjectionEntry(null)).toBe(false);
        expect(canRenderPluginUiProjectionEntry(undefined)).toBe(false);
    });

    it('renders entries without declared policy', () => {
        expect(canRenderPluginUiProjectionEntry({
            id: 'surfacePlacement:acme.preview:preview-pane',
            pluginId: 'acme.preview',
            contributionKind: 'surfacePlacement',
        })).toBe(true);
    });

    it('evaluates canonical platform availability', () => {
        const entry = {
            id: 'surfacePlacement:acme.preview:preview-pane',
            pluginId: 'acme.preview',
            contributionKind: 'surfacePlacement',
            availability: { when: { fact: 'host.platform', operator: 'equals', value: 'web' } },
        };
        expect(canRenderPluginUiProjectionEntry(entry, { platform: 'web' })).toBe(true);
        expect(canRenderPluginUiProjectionEntry(entry, { platform: 'ios' })).toBe(false);
    });

    it('fails closed when a required canonical feature fact has no resolver', () => {
        const entry = {
            id: 'surfacePlacement:acme.preview:review-tab',
            pluginId: 'acme.preview',
            contributionKind: 'surfacePlacement',
            availability: { when: { fact: 'host.feature', operator: 'enabled', value: 'plugins.ui.hostedWeb' } },
        };
        // No feature resolver supplied → fail-closed.
        expect(canRenderPluginUiProjectionEntry(entry)).toBe(false);
        // Feature enabled → rendered.
        expect(
            canRenderPluginUiProjectionEntry(entry, { isFeatureEnabled: (id) => id === 'plugins.ui.hostedWeb' }),
        ).toBe(true);
    });

    it('keeps an entry visible when canonical availability disables interaction', () => {
        const entry = {
            id: 'surfacePlacement:acme.preview:review-tab',
            pluginId: 'acme.preview',
            contributionKind: 'surfacePlacement',
            availability: {
                disabledWhen: { fact: 'host.feature', operator: 'enabled', value: 'acme.readOnly' },
                disabledReason: 'Read only',
            },
        };
        expect(canRenderPluginUiProjectionEntry(entry, { isFeatureEnabled: () => true })).toBe(true);
    });
});
