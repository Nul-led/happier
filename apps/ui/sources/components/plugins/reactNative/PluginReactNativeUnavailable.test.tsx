import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { t } from '@/text';
import { PluginReactNativeUnavailable } from './PluginReactNativeUnavailable';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: (props: any) => React.createElement('View', props, props.children),
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

describe('PluginReactNativeUnavailable', () => {
    it('preserves unavailable, Retry, and pending accessibility semantics', async () => {
        const unavailable = await renderScreen(
            <PluginReactNativeUnavailable diagnostics={['artifact_unavailable']} />,
        );
        expect(unavailable.findByTestId('plugin-rn-ui-unavailable')?.props.accessibilityLiveRegion).toBe('polite');
        expect(unavailable.findByTestId('plugin-rn-ui-unavailable-action')).toBeNull();

        const onRetry = vi.fn();
        const failed = await renderScreen(<PluginReactNativeUnavailable onRetry={onRetry} />);
        expect(failed.findByTestId('plugin-rn-ui-unavailable')?.props.accessibilityLiveRegion).toBe('assertive');
        expect(failed.findByTestId('plugin-rn-ui-unavailable-action')?.props.accessibilityLabel).toBe(t('common.retry'));
        await act(async () => {
            failed.pressByTestId('plugin-rn-ui-unavailable-action');
        });
        expect(onRetry).toHaveBeenCalledOnce();

        const retrying = await renderScreen(<PluginReactNativeUnavailable onRetry={onRetry} retrying />);
        expect(retrying.findByTestId('plugin-rn-ui-unavailable-loading-spinner')).toBeTruthy();
        expect(retrying.findByTestId('plugin-rn-ui-unavailable')?.props.accessibilityLiveRegion).toBe('polite');
        expect(retrying.findByTestId('plugin-rn-ui-unavailable-action')).toBeNull();
    });

    it.each([
        ['artifact_source_integrity_invalid', 'settingsPlugins.managePlugin'],
        ['artifact_incompatible', 'common.update'],
        ['module_instantiation_failed', 'settingsPlugins.managePlugin'],
    ] as const)('routes %s through the existing route recovery action as %s', async (diagnostic, labelKey) => {
        const onPress = vi.fn();
        const screen = await renderScreen(
            <PluginReactNativeUnavailable
                diagnostics={[diagnostic]}
                recoveryAction={{ label: 'route fallback', onPress }}
            />,
        );

        expect(screen.findByTestId('plugin-rn-ui-unavailable-action')?.props.accessibilityLabel).toBe(t(labelKey));
        await act(async () => {
            screen.pressByTestId('plugin-rn-ui-unavailable-action');
        });
        expect(onPress).toHaveBeenCalledOnce();
    });
});
