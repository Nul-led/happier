import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { AddTargetsSection } from './AddTargetsSection';

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props),
}));

const commonProps = {
    autoMode: false,
    inputUrl: '',
    inputName: '',
    error: 'Home unavailable',
    isValidating: true,
    reachabilityRemediation: null,
    onChangeUrl: vi.fn(),
    onChangeName: vi.fn(),
    onResetServer: vi.fn(),
    onAddServer: vi.fn(),
    onReachabilityRemediationAction: vi.fn(),
    servers: [],
    activeServerId: '',
    onCreateServerGroup: vi.fn(() => true),
} as const;

describe('AddTargetsSection accessibility', () => {
    it('associates persistent labels and announces add-Home validation state', async () => {
        const screen = await renderScreen(<AddTargetsSection {...commonProps} defaultExpanded="server" />);

        expect(screen.findByTestId('server-settings-add-url-input')?.props).toMatchObject({
            accessibilityLabel: 'Home address',
            accessibilityLabelledBy: 'server-settings-add-url-label',
        });
        expect(screen.findByTestId('server-settings-add-name-input')?.props).toMatchObject({
            accessibilityLabel: 'Home name',
            accessibilityLabelledBy: 'server-settings-add-name-label',
        });
        expect(screen.findByTestId('server-settings-add-error')?.props).toMatchObject({
            accessibilityRole: 'alert',
            accessibilityLiveRegion: 'assertive',
        });
        expect(screen.findByTestId('server-settings-add-validating')?.props).toMatchObject({
            role: 'status',
            accessibilityLiveRegion: 'polite',
        });
    });

    it('associates the persistent Home group name label', async () => {
        const screen = await renderScreen(<AddTargetsSection {...commonProps} error={null} isValidating={false} defaultExpanded="group" />);

        expect(screen.findByTestId('server-settings-add-group-name-input')?.props).toMatchObject({
            accessibilityLabel: 'Home group name',
            accessibilityLabelledBy: 'server-settings-add-group-name-label',
        });
    });
});
