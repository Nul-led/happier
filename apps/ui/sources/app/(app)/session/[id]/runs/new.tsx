import * as React from 'react';
import { View } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { ConstrainedScreenContent } from '@/components/ui/layout/ConstrainedScreenContent';
import { Text } from '@/components/ui/text/Text';
import { SessionExecutionRunLauncherView } from '@/components/sessions/runs/launcher/SessionExecutionRunLauncherView';
import { resolveExecutionRunLauncherIntent } from '@/components/sessions/runs/launcher/executionRunLauncherModel';
import { buildScopedSessionRouteHref, createSessionRouteServerScope } from '@/hooks/session/sessionRouteServerScope';
import { useHydrateSessionForRoute } from '@/hooks/session/useHydrateSessionForRoute';
import { normalizeSessionId } from '@/sync/domains/session/normalizeSessionId';
import { sessionAddressKey } from '@/sync/domains/session/sessionAddress';
import { isSessionRouteHydrationAvailable, isSessionRouteHydrationMissing } from '@/sync/domains/session/sessionRouteHydrationState';
import { t } from '@/text';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { SessionInteractiveExecutionRunDraftView } from '@/components/sessions/runs/launcher/SessionInteractiveExecutionRunDraftView';
import {
    consumeInteractiveExecutionRunDraftNavigationIntent,
    readInteractiveExecutionRunDraftNavigationIntent,
} from '@/components/sessions/runs/launcher/interactiveExecutionRunDraftNavigationIntent';

function readSingleRouteParam(value: string | string[] | undefined): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    const normalized = raw?.trim() ?? '';
    return normalized.length > 0 ? normalized : null;
}

function InteractiveExecutionRunDraftRoute(props: Readonly<{
    sessionId: string;
    serverId: string | null;
    draftCorrelationId: string | null;
    onRunStarted: (runId: string, recovery?: Readonly<{ retryInputLocalId: string }>) => void;
}>) {
    const navigationIntent = React.useMemo(() => props.serverId && props.draftCorrelationId
        ? readInteractiveExecutionRunDraftNavigationIntent({
            address: { serverId: props.serverId, sessionId: props.sessionId },
            correlationId: props.draftCorrelationId,
        })
        : null, [props.draftCorrelationId, props.serverId, props.sessionId]);
    React.useEffect(() => {
        if (!navigationIntent || !props.serverId || !props.draftCorrelationId) return;
        consumeInteractiveExecutionRunDraftNavigationIntent({
            address: { serverId: props.serverId, sessionId: props.sessionId },
            correlationId: props.draftCorrelationId,
        });
    }, [navigationIntent, props.draftCorrelationId, props.serverId, props.sessionId]);
    return (
        <SessionInteractiveExecutionRunDraftView
            sessionId={props.sessionId}
            serverId={props.serverId}
            initialText={navigationIntent?.initialText}
            launchOrigin={navigationIntent?.source}
            onRunStarted={props.onRunStarted}
        />
    );
}

export default function SessionNewRunScreen() {
    const { theme } = useUnistyles();
    const router = useRouter();
    const navigation = useNavigation();
    const params = useLocalSearchParams<{ id?: string | string[]; serverId?: string | string[]; intent?: string | string[]; draftCorrelationId?: string | string[] }>();
    const routeScope = React.useMemo(() => createSessionRouteServerScope(params as Record<string, unknown>), [params]);
    const sessionId = normalizeSessionId(params.id);
    const routeHydrationState = useHydrateSessionForRoute(sessionId, 'SessionNewRunScreen.hydrate', routeScope.hydrationOptions);
    const hydrateReady = isSessionRouteHydrationAvailable(routeHydrationState);
    const exactSessionServerId = routeHydrationState.serverId ?? routeScope.serverId;
    const rawIntent = params.intent;
    const hasIntentParam = rawIntent !== undefined;
    const initialIntent = resolveExecutionRunLauncherIntent(rawIntent);
    const draftCorrelationId = readSingleRouteParam(params.draftCorrelationId);
    const parentSessionHref = sessionId
        ? buildScopedSessionRouteHref({ sessionId, serverId: exactSessionServerId })
        : '/session';

    const screenOptions = React.useMemo(() => ({
        headerShown: true,
        headerTitle: hasIntentParam
            ? t('executionRuns.newRun.headerTitle')
            : t('session.subagents.panel.newAgentConversation'),
        headerBackTitle: t('common.back'),
    }), [hasIntentParam]);
    const handleRequestClose = React.useCallback(() => {
        safeRouterBack({
            router,
            navigation,
            fallbackHref: parentSessionHref,
        });
    }, [navigation, parentSessionHref, router]);

    if (hasIntentParam && initialIntent === null) {
        return (
            <View style={{ flex: 1, backgroundColor: theme.colors.background?.canvas ?? theme.colors.surface.base }}>
                <Stack.Screen options={screenOptions} />
                <ConstrainedScreenContent
                    style={{
                        flex: 1,
                        paddingHorizontal: 16,
                        paddingVertical: 16,
                        gap: 16,
                    }}
                >
                    <Text style={{ color: theme.colors.text.secondary }}>{t('errors.invalidFormat')}</Text>
                </ConstrainedScreenContent>
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background?.canvas ?? theme.colors.surface.base }}>
            <Stack.Screen options={screenOptions} />
            <ConstrainedScreenContent
                style={{
                    flex: 1,
                    paddingHorizontal: 16,
                    paddingVertical: 16,
                    gap: 16,
                }}
            >
                {!sessionId || isSessionRouteHydrationMissing(routeHydrationState) ? (
                    <Text style={{ color: theme.colors.text.primary }}>{t('errors.sessionDeleted')}</Text>
                ) : !hydrateReady ? (
                    <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                ) : (
                    hasIntentParam ? (
                        <SessionExecutionRunLauncherView
                            sessionId={sessionId}
                            serverId={exactSessionServerId}
                            routeHydrationState={routeHydrationState}
                            initialIntent={initialIntent ?? 'review'}
                            presentation="screen"
                            onRequestClose={handleRequestClose}
                        />
                    ) : (
                        <InteractiveExecutionRunDraftRoute
                            key={JSON.stringify([
                                exactSessionServerId
                                    ? sessionAddressKey({ serverId: exactSessionServerId, sessionId })
                                    : null,
                                draftCorrelationId ?? null,
                            ])}
                            sessionId={sessionId}
                            serverId={exactSessionServerId}
                            draftCorrelationId={draftCorrelationId}
                            onRunStarted={(runId, recovery) => {
                                router.replace(buildScopedSessionRouteHref({
                                    sessionId,
                                    serverId: exactSessionServerId,
                                    suffix: `/runs/${encodeURIComponent(runId)}`,
                                    query: recovery ? { retryInputLocalId: recovery.retryInputLocalId } : undefined,
                                }));
                            }}
                        />
                    )
                )}
            </ConstrainedScreenContent>
        </View>
    );
}
