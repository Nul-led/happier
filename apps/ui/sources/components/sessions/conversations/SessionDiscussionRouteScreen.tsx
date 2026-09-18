import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter, type Href } from 'expo-router';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useMobileWorkspaceExperienceState } from '@/components/workspaceCockpit/useMobileWorkspaceExperienceState';
import { normalizeSessionMobileSurface } from '@/components/workspaceCockpit/session/sessionCockpitState';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { createSessionRouteServerScope } from '@/hooks/session/sessionRouteServerScope';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { normalizeSessionId } from '@/sync/domains/session/normalizeSessionId';
import {
    isSessionRouteHydrationAvailable,
    isSessionRouteHydrationMissing,
} from '@/sync/domains/session/sessionRouteHydrationState';
import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import { t } from '@/text';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';

import { SessionInvalidLinkFallback } from '@/components/sessions/shell/SessionInvalidLinkFallback';
import { buildSessionCollaborationRouteHref } from '@/components/sessions/collaboration/useOpenSessionCollaboration';
import { SessionDiscussionDetailsView } from './SessionDiscussionDetailsView';
import { buildSessionDiscussionRouteHref } from './useOpenSessionDiscussion';

const minimumInteractiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);

const styles = StyleSheet.create((theme) => ({
    root: { flex: 1, backgroundColor: theme.colors.background?.canvas ?? theme.colors.surface.base },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    headerButton: { minWidth: minimumInteractiveTargetSize, minHeight: minimumInteractiveTargetSize, alignItems: 'center', justifyContent: 'center' },
}));

function readParam(value: string | string[] | undefined): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    const normalized = raw?.trim() ?? '';
    return normalized ? normalized : null;
}

export function SessionDiscussionRouteScreen(props: Readonly<{
    kind: 'new' | 'discussion';
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const params = useLocalSearchParams<{
        id?: string | string[];
        serverId?: string | string[];
        discussionId?: string | string[];
        sourceSurface?: string | string[];
    }>();
    const routeScope = React.useMemo(
        () => createSessionRouteServerScope(params as Readonly<Record<string, unknown>>),
        [params],
    );
    const sessionId = normalizeSessionId(params.id);
    const discussionId = readParam(params.discussionId);
    const hydration = useHydrateSessionForRoute(
        sessionId,
        'SessionDiscussionRouteScreen.hydrate',
        routeScope.hydrationOptions,
    );
    const hydrated = isSessionRouteHydrationAvailable(hydration);
    const missing = isSessionRouteHydrationMissing(hydration);
    const exactSessionServerId = hydration.serverId ?? routeScope.serverId;
    const address = normalizeSessionAddress(exactSessionServerId, sessionId);
    const { cockpitEnabled } = useMobileWorkspaceExperienceState();
    const sourceSurface = normalizeSessionMobileSurface(readParam(params.sourceSurface)) ?? 'collaboration';
    const fallbackHref = buildSessionCollaborationRouteHref({
        sessionId,
        serverId: exactSessionServerId,
        cockpitEnabled,
        focusTarget: 'top',
    });
    const onBack = React.useCallback(() => safeRouterBack({
        router,
        navigation,
        fallbackHref: fallbackHref as Href,
    }), [fallbackHref, navigation, router]);
    const headerLeft = React.useCallback(() => (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            testID="session-discussion-back"
            onPress={onBack}
            style={({ pressed }) => [styles.headerButton, pressed ? { opacity: 0.65 } : null]}
        >
            <Icon name="arrow-left" size={20} color={theme.colors.chrome.header.foreground} />
        </Pressable>
    ), [onBack, theme.colors.chrome.header.foreground]);
    const screenOptions = React.useMemo(() => ({
        headerShown: true,
        headerTitle: props.kind === 'new'
            ? t('session.collaboration.discussion.newDiscussion')
            : t('session.collaboration.discussion.title'),
        headerLeft,
    }), [headerLeft, props.kind]);

    const validTarget = address && (props.kind === 'new' || discussionId);
    return (
        <View style={styles.root}>
            <Stack.Screen options={screenOptions} />
            {!hydrated && !missing ? (
                <View style={styles.loading}><ActivitySpinner size="small" color={theme.colors.text.secondary} /></View>
            ) : !validTarget || missing ? (
                <SessionInvalidLinkFallback />
            ) : (
                <SessionDiscussionDetailsView
                    target={props.kind === 'new'
                        ? { kind: 'new', address }
                        : { kind: 'discussion', address, discussionId: discussionId! }}
                    active
                    onCreated={(discussion) => {
                        router.replace(buildSessionDiscussionRouteHref({
                            target: {
                                kind: 'discussion',
                                address,
                                discussionId: discussion.id,
                            },
                            sourceSurface,
                        }) as Href);
                    }}
                />
            )}
        </View>
    );
}
