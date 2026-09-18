import { useRouter } from 'expo-router';
import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text/Text';
import { useFriendsEnabled } from '@/hooks/server/useFriendsEnabled';
import { t } from '@/text';
import type { ItemAction } from '@/components/ui/lists/itemActions';
import { useFriendRequests } from '@/sync/domains/state/storage';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { desktopSidebarChromeStyles } from './desktopSidebarChromeStyles';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import {
    shouldForceFreshNewSessionEntryFromPressEvent,
    useResolveNewSessionOrdinaryEntryRoute,
} from '@/components/sessions/new/navigation/newSessionOrdinaryEntryRoute';

type SidebarHeaderActionsResult = Readonly<{
    headerActions: ItemAction[];
    topUtilityActions: ItemAction[];
    renderHeaderOverflowVisual: () => React.ReactNode;
}>;

export function useSidebarHeaderActions(): SidebarHeaderActionsResult {
    const styles = desktopSidebarChromeStyles;
    const { theme } = useUnistyles();
    const router = useRouter();
    const resolveNewSessionOrdinaryEntryRoute = useResolveNewSessionOrdinaryEntryRoute();
    const friendRequests = useFriendRequests();
    const friendsEnabled = useFriendsEnabled();
    const friendRequestCount = friendRequests.length;

    const navigate = React.useCallback((pathname: string, tag: string) => {
        const result = runGuardedNavigation(() => router.push(pathname));
        if (result !== true) {
            fireAndForget(result, { tag });
        }
    }, [router]);
    const navigateToNewSession = React.useCallback((event?: unknown) => {
        const { draftId, draftOrigin } = resolveNewSessionOrdinaryEntryRoute({
            forceFresh: shouldForceFreshNewSessionEntryFromPressEvent(event),
        });
        const result = runGuardedNavigation(() => router.push({
            pathname: '/new',
            params: { draftId, draftOrigin },
        }));
        if (result !== true) {
            fireAndForget(result, { tag: 'SidebarView.nav.newSession' });
        }
    }, [resolveNewSessionOrdinaryEntryRoute, router]);
    const headerActions = React.useMemo((): ItemAction[] => {
        const out: ItemAction[] = [];

        if (friendsEnabled) {
            out.push({
                id: 'friends',
                title: t('tabs.friends'),
                icon: (
                    <View style={[styles.iconButton, styles.notificationButton]}>
                        <Icon name="users" size={ICON_SIZE.md} color={theme.colors.chrome.header.foreground} />
                        {friendRequestCount > 0 ? (
                            <View style={styles.badge}>
                                <Text style={styles.badgeText}>
                                    {friendRequestCount > 99 ? '99+' : friendRequestCount}
                                </Text>
                            </View>
                        ) : null}
                    </View>
                ),
                onPress: () => navigate('/(app)/friends', 'SidebarView.nav.friends'),
            });
        }

        out.push({
            id: 'projects',
            title: t('tabs.projects'),
            inlineTestID: 'nav-projects',
            icon: (
                <Icon name="folder" size={ICON_SIZE.md} color={theme.colors.chrome.header.foreground} />
            ),
            onPress: () => navigate('/projects', 'SidebarView.nav.projects'),
        });

        out.push({
            id: 'settings',
            title: t('settings.title'),
            inlineTestID: 'nav-settings',
            icon: (
                <Icon name="sliders-horizontal" size={ICON_SIZE.md} color={theme.colors.chrome.header.foreground} />
            ),
            onPress: () => navigate('/settings', 'SidebarView.nav.settings'),
        });

        out.push({
            id: 'newSession',
            title: t('newSession.title'),
            inlineTestID: 'nav-new-session',
            icon: (
                // No wrapper: the control box centres this glyph. The old flex-end box was 24 wide
                // inside a wider control, which left the "+" 2px off its own centre.
                <Icon name="plus" size={ICON_SIZE.md} color={theme.colors.chrome.header.foreground} />
            ),
            onPress: navigateToNewSession,
        });

        return out;
    }, [
        friendRequestCount,
        friendsEnabled,
        navigate,
        navigateToNewSession,
        styles.badge,
        styles.badgeText,
        styles.iconButton,
        styles.notificationButton,
        theme.colors.chrome.header.foreground,
    ]);

    const topUtilityActions = React.useMemo((): ItemAction[] => {
        const out: ItemAction[] = [];

        out.push({
            id: 'settings',
            title: t('settings.title'),
            inlineTestID: 'nav-settings',
            icon: 'sliders-horizontal' as const,
            onPress: () => navigate('/settings', 'SidebarView.nav.settings'),
        });

        return out;
    }, [
        navigate,
    ]);

    const renderHeaderOverflowVisual = React.useCallback(() => {
        const shouldShowBadge = friendRequestCount > 0;
        return (
            <View style={[styles.iconButton, styles.notificationButton]}>
                <Icon name="dots-three" size={ICON_SIZE.md} color={theme.colors.chrome.header.foreground} />
                {shouldShowBadge ? (
                    <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                            {friendRequestCount > 99 ? '99+' : friendRequestCount}
                        </Text>
                    </View>
                ) : null}
            </View>
        );
    }, [
        friendRequestCount,
        styles.badge,
        styles.badgeText,
        styles.iconButton,
        styles.notificationButton,
        theme.colors.chrome.header.foreground,
    ]);

    return {
        headerActions,
        topUtilityActions,
        renderHeaderOverflowVisual,
    };
}
