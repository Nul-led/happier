import { describe, expect, it } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';
import { storage } from '@/sync/domains/state/storage';
import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';
import { useSessionDetailsPanelPluginRuntime } from './useSessionDetailsPanelPluginRuntime';

installSessionDetailsPanelCommonModuleMocks();

describe('useSessionDetailsPanelPluginRuntime', () => {
    it('qualifies direct details with its route Home instead of the locally visible Session Home', async () => {
        const sessions = storage.getState().sessions;
        storage.setState({ sessions: {
            ...sessions,
            'same-session': createSessionFixture({ id: 'same-session', serverId: 'visible-home', metadata: null }),
        } });
        try {
            const hook = await renderHook(() => useSessionDetailsPanelPluginRuntime({
                sessionId: 'same-session',
                routeServerId: 'destination-home',
                pluginUiProjection: null,
            }));
            expect(hook.getCurrent().serverId).toBe('destination-home');
            expect(hook.getCurrent().machineId).toBeNull();
            await hook.unmount();
        } finally {
            storage.setState({ sessions });
        }
    });
});
