import { createActivitySurfaceSessionRoute } from '@/activity/actions/activitySurfaceTargets';
import { router } from 'expo-router';
import * as React from 'react';
import { Platform } from 'react-native';

import { setActiveServerAndSwitch, upsertActivateAndSwitchServer } from '@/sync/domains/server/activeServerSwitch';
import {
    areServerProfileIdentifiersEquivalent,
    getActiveServerSnapshot,
    listServerProfiles,
} from '@/sync/domains/server/serverProfiles';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { clearPendingNotificationNav, getPendingNotificationNav, setPendingNotificationNav } from '@/sync/domains/pending/pendingNotificationNav';
import {
    clearPendingNotificationAction,
    getPendingNotificationAction,
    setPendingNotificationAction,
} from '@/sync/domains/pending/pendingNotificationAction';
import { loadExpoNotifications, type ExpoNotificationsModule } from '@/utils/platform/loadExpoNotifications';
import { resolveRoutineServerSelectionScope } from '@/sync/domains/server/selection/serverSelectionScope';
import { isDesktopHost } from '@/utils/platform/desktopHost';

import { isUnsafeNotificationServerUrl, parseNotificationTap } from '../notificationRouting';
// The same saved-Home rule names the Home of an arriving foreground notification.
import { resolveNotificationSavedHome as findSavedServerProfile } from '../resolveNotificationSavedHome';
import type { ActivityInteractionCommand } from '@/activity/actions/resolveActivityInteractionCommand';

type ExpoNotificationsWithClear = ExpoNotificationsModule & Readonly<{
    clearLastNotificationResponseAsync?: () => Promise<void>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPermissionDecisionPayload(value: unknown): Readonly<{
    action: 'allow' | 'deny';
    sessionId: string;
    requestId: string;
    turnId?: string;
}> | null {
    if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.requestId !== 'string') {
        return null;
    }
    const action = value.decision === 'allow' || value.decision === 'deny'
        ? value.decision
        : value.action === 'allow' || value.action === 'deny'
            ? value.action
            : null;
    if (!action) {
        return null;
    }
    return {
        action,
        sessionId: value.sessionId,
        requestId: value.requestId,
        ...(typeof value.turnId === 'string' && value.turnId.trim().length > 0
            ? { turnId: value.turnId.trim() }
            : {}),
    };
}

function resolveNotificationCommandRoute(command: ActivityInteractionCommand): string | null {
    switch (command.kind) {
        case 'openSession':
        case 'openInbox':
        case 'focusComposer':
        case 'openSettings':
        case 'openWorkflowRun':
            return command.route;
        case 'executeAction':
            return createActivitySurfaceSessionRoute(command.defaultSessionId, command.target.serverId);
        case 'ignore':
        default:
            return null;
    }
}

function resolveNotificationCommandServerUrl(command: ActivityInteractionCommand): string | null {
    switch (command.kind) {
        case 'openSession':
        case 'focusComposer':
        case 'openWorkflowRun':
            return command.serverUrl;
        case 'executeAction':
            return command.target.serverUrl ?? null;
        case 'openInbox':
        case 'openSettings':
        case 'ignore':
        default:
            return null;
    }
}

function resolveNotificationCommandServerId(command: ActivityInteractionCommand): string | null {
    switch (command.kind) {
        case 'openSession':
        case 'focusComposer':
        case 'openWorkflowRun':
            return command.serverId;
        case 'executeAction':
            return command.target.serverId;
        case 'openInbox':
        case 'openSettings':
        case 'ignore':
        default:
            return null;
    }
}

function isNotificationServerActive(params: Readonly<{
    serverId?: string | null;
    serverUrl: string;
}>): boolean {
    const active = getActiveServerSnapshot();
    const serverId = String(params.serverId ?? '').trim();
    const targetUrlKey = createServerUrlComparableKey(params.serverUrl);
    const activeUrlKey = createServerUrlComparableKey(active.serverUrl);
    if (serverId) {
        return areServerProfileIdentifiersEquivalent(serverId, active.serverId);
    }

    const saved = findSavedServerProfile({ serverId: null, serverUrl: params.serverUrl });
    if (saved) {
        return areServerProfileIdentifiersEquivalent(saved.id, active.serverId);
    }

    // Legacy URL-only records created before a profile was persisted can still
    // complete once their URL is the active Home. Duplicate saved matches fail closed.
    const matchingProfileCount = targetUrlKey
        ? listServerProfiles().filter(
            (profile) => createServerUrlComparableKey(profile.serverUrl) === targetUrlKey,
        ).length
        : 0;
    return matchingProfileCount === 0 && Boolean(targetUrlKey && targetUrlKey === activeUrlKey);
}

/**
 * Names the Home a notification was admitted for, synchronously at the moment
 * `isNotificationServerActive` proved it. An explicit notification Home wins; a
 * legacy URL-only record was only admitted because its URL is the focused Home
 * right now, so that Home is captured before any await can move focus.
 */
function resolveAdmittedNotificationServerId(serverId: string | null | undefined): string | null {
    const explicit = String(serverId ?? '').trim();
    if (explicit) return explicit;
    const active = String(getActiveServerSnapshot().serverId ?? '').trim();
    return active || null;
}

export function useNotificationResponseRouting(params: Readonly<{
    enabled: boolean;
    refreshAuth: () => Promise<void>;
}>): void {
    const handledNotificationResponseKeysRef = React.useRef<Set<string>>(new Set());
    const refreshAuthRef = React.useRef(params.refreshAuth);

    React.useEffect(() => {
        refreshAuthRef.current = params.refreshAuth;
    }, [params.refreshAuth]);

    React.useEffect(() => {
        if (!params.enabled) {
            handledNotificationResponseKeysRef.current.clear();
            return;
        }

        if (Platform.OS === 'web') return;

        // The permission response is a mutation on the exact Home the notification was
        // admitted for (L09B-I15). That Home is named before any await; the dispatch
        // never re-infers it from whichever Home is focused when the import resolves.
        const performPermissionAction = async (actionParams: {
            serverId: string | null;
            sessionId: string;
            requestId: string;
            turnId?: string;
            action: 'allow' | 'deny';
        }): Promise<void> => {
            const serverId = String(actionParams.serverId ?? '').trim();
            if (!serverId) return;
            const { sessionAllow, sessionDeny } = await import('@/sync/ops');
            if (actionParams.action === 'allow') {
                await sessionAllow(
                    actionParams.sessionId,
                    actionParams.requestId,
                    undefined,
                    undefined,
                    'approved',
                    undefined,
                    actionParams.turnId,
                    { serverId },
                );
            } else {
                await sessionDeny(
                    actionParams.sessionId,
                    actionParams.requestId,
                    undefined,
                    undefined,
                    'denied',
                    'Denied from notification',
                    actionParams.turnId,
                    { serverId },
                );
            }
        };

        const pendingAction = getPendingNotificationAction();
        if (pendingAction) {
            if (isNotificationServerActive(pendingAction)) {
                const admittedServerId = resolveAdmittedNotificationServerId(pendingAction.serverId);
                clearPendingNotificationAction();
                fireAndForget((async () => {
                    try {
                        await performPermissionAction({
                            serverId: admittedServerId,
                            sessionId: pendingAction.sessionId,
                            requestId: pendingAction.requestId,
                            ...(pendingAction.turnId ? { turnId: pendingAction.turnId } : {}),
                            action: pendingAction.action,
                        });
                    } catch {
                        // best-effort; navigation still proceeds
                    }
                    router.push(createActivitySurfaceSessionRoute(pendingAction.sessionId, pendingAction.serverId));
                })(), { tag: 'RootLayout.pendingNotificationAction' });
                return;
            }
        }

        const pending = getPendingNotificationNav();
        if (pending) {
            if (isNotificationServerActive(pending)) {
                clearPendingNotificationNav();
                router.push(pending.route);
                return;
            }
        }

        const maybeRedirectFromResponse = (response: unknown, defaultActionIdentifier: string) => {
            const parsed = parseNotificationTap({
                response,
                defaultActionIdentifier,
            });
            if (!parsed) return;
            const command = parsed.command;
            if (command.kind === 'ignore') return;

            if (parsed.dedupeKey) {
                const handled = handledNotificationResponseKeysRef.current;
                if (handled.size > 512) {
                    handled.clear();
                }
                if (handled.has(parsed.dedupeKey)) return;
                handled.add(parsed.dedupeKey);
            }

            const route = resolveNotificationCommandRoute(command);
            if (!route) return;

            const serverUrl = resolveNotificationCommandServerUrl(command);
            const serverId = resolveNotificationCommandServerId(command);
            const routeToServerSettingsForUrl = (url: string) => {
                router.push(`/server?url=${encodeURIComponent(url)}&source=notification`);
            };

            // Permission action buttons are security-sensitive. Only perform allow/deny when:
            // - the server is already active, OR
            // - the server is already saved (we can switch safely), OR
            // - (otherwise) navigate only and let the user handle it in-app.
            const permissionDecisionPayload = command.kind === 'executeAction'
                && command.actionId === 'session.permission.respond'
                ? readPermissionDecisionPayload(command.payload)
                : null;
            if (command.kind === 'executeAction' && permissionDecisionPayload) {
                const { action, sessionId: actionSessionId, requestId: actionRequestId, turnId } = permissionDecisionPayload;
                if (!serverUrl) {
                    router.push(route);
                    return;
                }

                if (!isNotificationServerActive({ serverId, serverUrl })) {
                    const saved = findSavedServerProfile({ serverId, serverUrl });
                    if (!saved) {
                        if (isUnsafeNotificationServerUrl(serverUrl)) {
                            router.push(route);
                            return;
                        }
                        // If the app has no servers, we can auto-add/switch to restore a working deep link,
                        // but never perform the allow/deny action on an unsaved server.
                        if (listServerProfiles().length === 0) {
                            setPendingNotificationNav({ serverUrl, route });
                            fireAndForget((async () => {
                                try {
                                    await upsertActivateAndSwitchServer({
                                        serverUrl,
                                        source: 'notification',
                                        scope: resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost()),
                                        refreshAuth: refreshAuthRef.current,
                                    });
                                    clearPendingNotificationNav();
                                    router.push(route);
                                } catch {
                                    // keep pending notification nav as fallback
                                }
                            })(), { tag: 'RootLayout.notificationNav.autoAddServer.actionTap' });
                            return;
                        }
                        // Servers exist but the target isn't saved: redirect to server settings with a prefilled url.
                        setPendingNotificationNav({ serverUrl, route });
                        routeToServerSettingsForUrl(serverUrl);
                        return;
                    }

                    setPendingNotificationAction({
                        serverUrl: saved.serverUrl,
                        serverId: saved.id,
                        sessionId: actionSessionId,
                        requestId: actionRequestId,
                        ...(turnId ? { turnId } : {}),
                        action,
                    });
                    fireAndForget((async () => {
                        try {
                            await setActiveServerAndSwitch({
                                serverId: saved.id,
                                scope: resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost()),
                                refreshAuth: refreshAuthRef.current,
                            });
                            clearPendingNotificationAction();
                            try {
                                await performPermissionAction({ serverId: saved.id, sessionId: actionSessionId, requestId: actionRequestId, ...(turnId ? { turnId } : {}), action });
                            } catch {
                                // best-effort
                            }
                            router.push(route);
                        } catch {
                            // keep pending notification action as fallback
                        }
                    })(), { tag: 'RootLayout.notificationAction.savedServer' });
                    return;
                }
            }

            if (serverUrl) {
                if (!isNotificationServerActive({ serverId, serverUrl })) {
                    const saved = findSavedServerProfile({ serverId, serverUrl });
                    if (saved) {
                        setPendingNotificationNav({ serverUrl: saved.serverUrl, serverId: saved.id, route });
                        fireAndForget((async () => {
                            try {
                                await setActiveServerAndSwitch({
                                    serverId: saved.id,
                                    scope: resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost()),
                                    refreshAuth: refreshAuthRef.current,
                                });
                                clearPendingNotificationNav();
                                router.push(route);
                            } catch {
                                // keep pending notification nav as fallback
                            }
                        })(), { tag: 'RootLayout.notificationNav.savedServer' });
                        return;
                    }

                    if (isUnsafeNotificationServerUrl(serverUrl)) {
                        // Unsafe/mismatched server url: fail closed for actions; navigate only.
                        router.push(route);
                        return;
                    }

                    if (listServerProfiles().length === 0) {
                        setPendingNotificationNav({ serverUrl, route });
                        fireAndForget((async () => {
                            try {
                                await upsertActivateAndSwitchServer({
                                    serverUrl,
                                    source: 'notification',
                                    scope: resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost()),
                                    refreshAuth: refreshAuthRef.current,
                                });
                                clearPendingNotificationNav();
                                router.push(route);
                            } catch {
                                // keep pending notification nav as fallback
                            }
                        })(), { tag: 'RootLayout.notificationNav.autoAddServer' });
                        return;
                    }
                    // Servers exist but the target isn't saved: redirect to server settings with a prefilled url.
                    setPendingNotificationNav({ serverUrl, route });
                    routeToServerSettingsForUrl(serverUrl);
                    return;
                }
            }

            const activeServerPermissionDecisionPayload = command.kind === 'executeAction'
                && command.actionId === 'session.permission.respond'
                ? readPermissionDecisionPayload(command.payload)
                : null;
            if (command.kind === 'executeAction' && activeServerPermissionDecisionPayload) {
                const { action, sessionId: actionSessionId, requestId: actionRequestId, turnId } = activeServerPermissionDecisionPayload;
                const admittedServerId = resolveAdmittedNotificationServerId(serverId);
                fireAndForget((async () => {
                    try {
                        await performPermissionAction({ serverId: admittedServerId, sessionId: actionSessionId, requestId: actionRequestId, ...(turnId ? { turnId } : {}), action });
                    } catch {
                        // best-effort
                    }
                    router.push(route);
                })(), { tag: 'RootLayout.notificationAction.activeServer' });
                return;
            }

            if (
                command.kind === 'openSession'
                || command.kind === 'openInbox'
                || command.kind === 'focusComposer'
                || command.kind === 'openSettings'
                || command.kind === 'openWorkflowRun'
            ) {
                router.push(route);
            }
        };

        let disposed = false;
        let subscription: { remove: () => void } | null = null;
        void loadExpoNotifications()
            .then((Notifications) => {
                if (disposed) return;
                const defaultActionIdentifier = Notifications.DEFAULT_ACTION_IDENTIFIER;
                void Notifications.getLastNotificationResponseAsync()
                    .then(async (response) => {
                        if (!response) return;
                        maybeRedirectFromResponse(response, defaultActionIdentifier);
                        const clearLastNotificationResponseAsync = (Notifications as ExpoNotificationsWithClear).clearLastNotificationResponseAsync;
                        if (typeof clearLastNotificationResponseAsync === 'function') {
                            await clearLastNotificationResponseAsync();
                        }
                    })
                    .catch(() => {});

                subscription = Notifications.addNotificationResponseReceivedListener((response) => {
                    maybeRedirectFromResponse(response, defaultActionIdentifier);
                });
            })
            .catch(() => {});

        return () => {
            disposed = true;
            subscription?.remove();
        };
    }, [params.enabled]);
}
