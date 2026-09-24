import * as React from 'react';
import { View } from 'react-native';
import { Item } from '@/components/ui/lists/Item';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Modal } from '@/modal';
import { useMountedRef } from '@/hooks/ui/useMountedRef';
import { t } from '@/text';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';
import { useSessionHumanPresence } from '@/sync/domains/session/humanPresence/useSessionHumanPresence';
import { PoliteAccessibilityStatus } from '@/components/ui/accessibility/PoliteAccessibilityStatus';
import { STALE_PRESENCE_OPACITY } from './SessionViewerFacepile';
import { formatSessionPresenceViewerNames } from './sessionPresenceNames';

const styles = StyleSheet.create({
    // Retained last-known rows are de-emphasized exactly like the header
    // facepile. The `May be out of date` text carries the meaning; the
    // treatment never relies on color alone.
    stale: { opacity: STALE_PRESENCE_OPACITY },
});

export function SessionPresenceSection(target: SessionAddress) {
    const presence = useSessionHumanPresence(target);
    // The plan announces a viewer arrival or departure only to someone who has
    // navigated INTO this region; an unfocused polite region speaks every
    // presence change of every open Session. Focus is read from the existing
    // summary anchor rather than from a new subscription.
    const [regionFocused, setRegionFocused] = React.useState(false);
    const onRegionFocus = React.useCallback(() => setRegionFocused(true), []);
    const onRegionBlur = React.useCallback(() => setRegionFocused(false), []);
    const mounted = useMountedRef();
    const summaryAnchor = React.useRef<React.ElementRef<typeof View>>(null);
    const modalId = React.useRef<string | null>(null);
    const currentTarget = React.useRef(target);
    currentTarget.current = target;
    React.useEffect(() => () => {
        if (modalId.current) Modal.hide(modalId.current);
        modalId.current = null;
    }, [target.serverId, target.sessionId]);
    const { theme } = useUnistyles();
    if (presence.status === 'unsupported') return null;
    const hasViewers = presence.viewers.length > 0;
    const status = presence.status === 'stale' ? t('session.collaboration.stale')
        : presence.status === 'unavailable' ? t('session.collaboration.unavailable')
            : presence.status === 'connecting' ? t('session.collaboration.connecting')
                : hasViewers ? formatSessionPresenceViewerNames(presence.viewers)
                    : t('session.collaboration.justYou');
    const names = formatSessionPresenceViewerNames(presence.viewers, { stale: true });
    // Membership and reachability are the meaningful transitions. A typing
    // renewal keeps this key, so the one live-region owner coalesces it away
    // instead of re-reading the row aloud.
    const membershipTransitionKey = `${presence.status}|${presence.viewers.map((viewer) => viewer.account.accountId).join(',')}`;
    const announcement = `${t('session.collaboration.viewingNow')}: ${hasViewers ? names : status}`;
    const openViewers = async () => {
        const { SessionPresenceViewerList } = await import('./SessionPresenceViewerList');
        if (!mounted.current || currentTarget.current.serverId !== target.serverId || currentTarget.current.sessionId !== target.sessionId) return;
        if (modalId.current) return;
        const id = Modal.show({
            component: SessionPresenceViewerList,
            props: { target },
            chrome: { kind: 'card', title: t('session.collaboration.viewingNow'), dimensions: { width: 520, maxHeightRatio: 0.85, size: 'md' } },
            // Closing the complete viewer list returns focus to the summary that
            // opened it, through the canonical modal focus-return contract.
            focusReturnRef: summaryAnchor,
            onDismissRequest: () => { modalId.current = null; },
            closeOnBackdrop: true,
        });
        if (!mounted.current || currentTarget.current.serverId !== target.serverId || currentTarget.current.sessionId !== target.sessionId) Modal.hide(id);
        else modalId.current = id;
    };
    return <View testID="session-presence-section">
        <View ref={summaryAnchor} tabIndex={-1} testID="session-presence-summary-anchor"
            onFocus={onRegionFocus} onBlur={onRegionBlur}
            style={presence.status === 'stale' ? styles.stale : undefined}>
            <Item testID="session-presence-summary" title={t('session.collaboration.viewingNow')}
                // The visible row always carries the current fact, including typing.
                // It is deliberately NOT the live region: announcing is owned by the
                // focus-qualified status below.
                subtitle={<Text testID="session-presence-status"
                >{presence.status === 'stale' && hasViewers ? `${names} · ${status}` : status}</Text>}
                icon={<Icon name="users" size={ICON_SIZE.xl} color={theme.colors.text.secondary} />}
                showChevron={hasViewers} onPress={hasViewers ? () => { void openViewers(); } : undefined}
                accessibilityLabel={`${t('session.collaboration.viewingNow')}: ${names}${names ? '. ' : ''}${status}`}
            />
            {regionFocused ? (
                <PoliteAccessibilityStatus
                    statusTestID="session-presence-announcement"
                    announcement={announcement}
                    transitionKey={membershipTransitionKey}
                />
            ) : null}
        </View>
    </View>;
}
