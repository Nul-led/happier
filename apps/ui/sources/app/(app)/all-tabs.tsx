import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { SessionAllTabsPageView } from '@/components/sessions/shell/SessionAllTabsOverview';
import { useSessionAllTabsPage } from '@/components/sessions/shell/useSessionAllTabsOpener';

/** All tabs (phone): reached by pulling the session title down. `?sessionId=&serverId=` name where you came from. */
export default function AllTabsScreen() {
    const params = useLocalSearchParams<{ sessionId?: string; serverId?: string }>();
    const page = useSessionAllTabsPage({
        sessionId: typeof params.sessionId === 'string' ? params.sessionId : '',
        serverId: typeof params.serverId === 'string' && params.serverId ? params.serverId : null,
    });
    return (
        <SessionAllTabsPageView
            sections={page.snapshot.sections}
            currentKey={page.snapshot.currentKey}
            onOpen={page.open}
            onDone={page.done}
        />
    );
}
