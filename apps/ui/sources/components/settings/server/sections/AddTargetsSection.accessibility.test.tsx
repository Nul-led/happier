import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { ServerProfile } from '@/sync/domains/server/serverProfiles';
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

function serverProfile(id: string, name: string, serverUrl: string): ServerProfile {
    return { id, name, serverUrl, createdAt: 0, updatedAt: 0, lastUsedAt: 0 };
}

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

    it('seeds a group from the requested Homes once without overwriting later edits', async () => {
        const { act } = await import('react-test-renderer');
        const servers = [
            serverProfile('home-a', 'Home A', 'https://a.example'),
            serverProfile('home-b', 'Home B', 'https://b.example'),
            serverProfile('home-c', 'Home C', 'https://c.example'),
        ];
        const screen = await renderScreen(
            <AddTargetsSection
                {...commonProps}
                error={null}
                isValidating={false}
                servers={servers}
                activeServerId="home-a"
                defaultExpanded="group"
                initialGroupServerIds={['home-b', 'home-a', 'home-b']}
            />,
        );

        expect(screen.findByTestId('server-group-add-member-home-a')?.props['aria-checked']).toBe(true);
        expect(screen.findByTestId('server-group-add-member-home-b')?.props['aria-checked']).toBe(true);
        expect(screen.findByTestId('server-group-add-member-home-c')?.props['aria-checked']).toBe(false);

        await act(async () => {
            screen.pressByTestId('server-group-add-member-home-b');
        });
        await screen.update(
            <AddTargetsSection
                {...commonProps}
                error={null}
                isValidating={false}
                servers={servers}
                activeServerId="home-a"
                defaultExpanded="group"
                initialGroupServerIds={['home-b', 'home-c']}
            />,
        );

        expect(screen.findByTestId('server-group-add-member-home-a')?.props['aria-checked']).toBe(true);
        expect(screen.findByTestId('server-group-add-member-home-b')?.props['aria-checked']).toBe(false);
        expect(screen.findByTestId('server-group-add-member-home-c')?.props['aria-checked']).toBe(false);
    });

    it('keeps an explicit empty Home seed empty instead of falling back to the focused Home', async () => {
        const screen = await renderScreen(
            <AddTargetsSection
                {...commonProps}
                error={null}
                isValidating={false}
                servers={[serverProfile('home-a', 'Home A', 'https://a.example')]}
                activeServerId="home-a"
                defaultExpanded="group"
                initialGroupServerIds={[]}
            />,
        );

        expect(screen.findByTestId('server-group-add-member-home-a')?.props['aria-checked']).toBe(false);
    });
});
