import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { SERVERS_SETTINGS } from '@/components/settings/server/serverSettings';
import { AddTargetsSection } from './AddTargetsSection';

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const { SERVERS_SETTINGS: settings } = await import('@/components/settings/server/serverSettings');
    return createExpoRouterMock({ params: { setting: settings.settings.addHome.anchor } }).module;
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

describe('AddTargetsSection', () => {
    it('opens the add-a-Home form when the page asks for it by its anchor', async () => {
        const screen = await renderScreen(<AddTargetsSection
            autoMode={false}
            inputUrl=""
            inputName=""
            error={null}
            isValidating={false}
            reachabilityRemediation={null}
            onChangeUrl={vi.fn()}
            onChangeName={vi.fn()}
            onResetServer={vi.fn()}
            onAddServer={vi.fn()}
            onReachabilityRemediationAction={vi.fn()}
            servers={[]}
            activeServerId=""
            onCreateServerGroup={vi.fn(() => true)}
        />);

        expect(screen.findByTestId('server-settings-add-url-input')).not.toBeNull();
        expect(SERVERS_SETTINGS.settings.addHome.anchor).toBeTruthy();
    });
});
