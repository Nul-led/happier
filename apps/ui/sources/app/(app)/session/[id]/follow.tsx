import * as React from 'react';
import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { openFollowNotificationSettings } from '@/components/sessions/follow/openFollowNotificationSettings';
import { AccountSessionFollowControl } from '@/components/sessions/follow/AccountSessionFollowControl';
import { SessionInvalidLinkFallback } from '@/components/sessions/shell/SessionInvalidLinkFallback';
import { ItemList } from '@/components/ui/lists/ItemList';
import { layout } from '@/components/ui/layout/layout';
import { buildScopedSessionRouteHref, readSessionRouteServerId } from '@/hooks/session/sessionRouteServerScope';
import { normalizeSessionId } from '@/sync/domains/session/normalizeSessionId';
import { t } from '@/text';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';

export default function SessionFollowScreen() {
    const params = useLocalSearchParams<{ id?: string | string[]; serverId?: string | string[]; archived?: string }>();
    const router = useRouter();
    const openingSettings = React.useRef(false);
    const sessionId = normalizeSessionId(params.id);
    const serverId = readSessionRouteServerId(params);
    if (!sessionId || !serverId) return <SessionInvalidLinkFallback />;
    const address = { serverId, sessionId };
    return <>
        <Stack.Screen options={{ headerShown: true, headerTitle: t('session.follow.editor.title') }} />
        <ItemList containerStyle={{ maxWidth: layout.maxWidth, width: '100%', alignSelf: 'center' }}>
            <AccountSessionFollowControl
                address={address}
                archived={params.archived === '1'}
                onClose={() => {
                    if (!openingSettings.current) safeRouterBack({ router, fallbackHref: buildScopedSessionRouteHref(address) as Href });
                }}
                onOpenNotificationSettings={() => {
                    openingSettings.current = true;
                    void openFollowNotificationSettings({
                        serverId,
                        navigate: () => router.replace('/settings/notifications'),
                    }).finally(() => { openingSettings.current = false; });
                }}
            />
        </ItemList>
    </>;
}
