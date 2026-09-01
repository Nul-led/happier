import * as React from 'react';
import { Platform, View, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t, type TranslationKeyNoParams } from '@/text';
import { StatusDot } from '@/components/ui/status/StatusDot';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status/StatusPill';
import { Popover } from '@/components/ui/popover';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { useSocketStatus, useSyncError, useLastSyncAt, useMachineListStatusByServerId, useSettings } from '@/sync/domains/state/storage';
import { useHomeViewSelectionSettingsMutable } from '@/hooks/server/useHomeViewSelectionSettings';
import {
    areServerProfileIdentifiersEquivalent,
    listServerProfiles,
    resolveServerProfileScopeId,
} from '@/sync/domains/server/serverProfiles';
import { useAuth } from '@/auth/context/AuthContext';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { useRouter } from 'expo-router';
import { setActiveServerAndSwitch } from '@/sync/domains/server/activeServerSwitch';
import { Typography } from '@/constants/Typography';
import { listServerSelectionTargets } from '@/sync/domains/server/selection/serverSelectionResolver';
import { resolveActiveServerSelectionFromRawSettings } from '@/sync/domains/server/selection/serverSelectionResolution';
import { normalizeStoredServerSelectionGroups } from '@/sync/domains/server/selection/serverSelectionMutations';
import {
    listServerProfileScopeIds,
    normalizeServerSelectionSettingsForProfileScopeIds,
} from '@/sync/domains/server/selection/serverSelectionProfileScopeIds';
import { buildServerSelectionActiveTargetForServer } from '@/sync/domains/server/selection/serverSelectionActiveTarget';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';
import { useConnectionTargetActions } from '@/components/navigation/connection/useConnectionTargetActions';
import { Text } from '@/components/ui/text/Text';
import { useConnectionHealth } from '@/components/navigation/connectionStatus/useConnectionHealth';
import { resolveMachineConnectionSummary } from '@/components/navigation/connectionStatus/resolveMachineConnectionSummary';
import { retryActiveServerConnection } from '@/sync/runtime/orchestration/connectionManager';
import { resolveSocketErrorClassification } from '@/sync/runtime/connectivity/resolveSocketErrorClassification';
import { selectSyncErrorForServer } from '@/sync/runtime/connectivity/syncErrorScope';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { useServerAuthStatusByServerId } from '@/components/settings/server/hooks/useServerAuthStatusByServerId';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { ConnectionTargetList } from '@/components/navigation/connection/ConnectionTargetList';
import { resolveRoutineServerSelectionScope } from '@/sync/domains/server/selection/serverSelectionScope';
import { resolveServerSelectionGroupActivation } from '@/sync/domains/server/selection/serverSelectionActivation';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { isDesktopHost } from '@/utils/platform/desktopHost';

type Variant = 'sidebar' | 'header';
const RELAY_SETTINGS_ROUTE = '/settings/server';
const POPOVER_MAX_WIDTH = 420;
const POPOVER_MIN_WIDTH = 220;
const minimumInteractiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);

type ConnectionStatusKey = 'connected' | 'connecting' | 'disconnected' | 'error' | 'action_required' | 'unknown';

function resolveConnectionStatusPillVariant(status: ConnectionStatusKey): StatusPillVariant {
    switch (status) {
        case 'connected':
            return 'success';
        case 'connecting':
            return 'info';
        case 'action_required':
            return 'warning';
        case 'error':
            return 'danger';
        case 'disconnected':
        case 'unknown':
            return 'neutral';
    }
}

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        position: 'relative',
        zIndex: 2000,
        overflow: 'visible',
        flexShrink: 1,
        minWidth: 0,
        maxWidth: '100%',
    },
    statusContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: -2,
        flexWrap: 'nowrap' as const,
        flexShrink: 1,
        minWidth: 0,
        maxWidth: '100%',
        overflow: 'visible',
        minHeight: minimumInteractiveTargetSize,
    },
    statusText: {
        lineHeight: 16,
        ...Typography.default(),
        flexGrow: 0,
        flexShrink: 1,
        minWidth: 0,
    },
    statusChevron: {
        marginLeft: 2,
        marginTop: 1,
        opacity: 0.9,
    },
    popoverContent: {
        paddingTop: 8,
        paddingBottom: 6,
    },
    popoverHeader: {
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    popoverTitle: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.default('semiBold'),
        textTransform: 'uppercase',
    },
    popoverStatusList: {
        paddingHorizontal: 12,
        gap: 10,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 14,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderWidth: 1,
        backgroundColor: theme.colors.surface.inset,
        borderColor: theme.colors.border.default,
    },
    statusRowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flexShrink: 1,
        minWidth: 0,
    },
    statusRowIcon: {
        width: 28,
        height: 28,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.colors.surface.base,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
    },
    statusRowText: {
        flexShrink: 1,
        minWidth: 0,
    },
    statusRowTitle: {
        fontSize: 13,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
        lineHeight: 16,
    },
    statusRowSubtitle: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.default(),
        lineHeight: 16,
        marginTop: 2,
    },
    statusRowRight: {
        marginLeft: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    statusRowRetryButton: {
        minWidth: minimumInteractiveTargetSize,
        minHeight: minimumInteractiveTargetSize,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    popoverStatusPill: {
        flexShrink: 0,
    },
    statusMeta: {
        paddingHorizontal: 16,
        paddingTop: 10,
        gap: 6,
    },
    statusMetaRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        alignItems: 'flex-start',
    },
    statusMetaLabel: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.default(),
    },
    statusMetaValue: {
        fontSize: 12,
        color: theme.colors.text.primary,
        ...Typography.default(),
    },
    popoverActionsRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    popoverActionButton: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 10,
        backgroundColor: theme.colors.background.canvas,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        minHeight: minimumInteractiveTargetSize,
        justifyContent: 'center',
    },
    popoverActionButtonText: {
        fontSize: 12,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
    },
    popoverSection: {
        paddingHorizontal: 16,
        paddingTop: 8,
        gap: 0,
    },
    popoverSectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    popoverSectionTitle: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.default('semiBold'),
        textTransform: 'uppercase',
    },
    popoverSectionIconButton: {
        minWidth: minimumInteractiveTargetSize,
        minHeight: minimumInteractiveTargetSize,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    popoverRelayBlock: {
        marginBottom: 12,
    },
    detailsDisclosure: {
        minHeight: minimumInteractiveTargetSize,
        marginHorizontal: 16,
        marginTop: 8,
        paddingHorizontal: 4,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    detailsDisclosureText: {
        fontSize: 13,
        color: theme.colors.text.secondary,
        ...Typography.default('semiBold'),
    },
}));

function formatTime(ts: number | null): string {
    if (!ts) return '—';
    try {
        return new Date(ts).toLocaleString();
    } catch {
        return '—';
    }
}

function resolveStatusPresentation(
    theme: { colors: { status: Record<string, string> } },
    status: ConnectionStatusKey,
): { labelKey: TranslationKeyNoParams; color: string; dotColor: string; pillVariant: StatusPillVariant } {
    switch (status) {
        case 'connected':
            return { labelKey: 'status.connected', color: theme.colors.status.connected, dotColor: theme.colors.status.connected, pillVariant: resolveConnectionStatusPillVariant(status) };
        case 'connecting':
            return { labelKey: 'status.connecting', color: theme.colors.status.connecting, dotColor: theme.colors.status.connecting, pillVariant: resolveConnectionStatusPillVariant(status) };
        case 'action_required':
            return { labelKey: 'status.actionRequired', color: theme.colors.status.actionRequired, dotColor: theme.colors.status.actionRequired, pillVariant: resolveConnectionStatusPillVariant(status) };
        case 'error':
            return { labelKey: 'status.error', color: theme.colors.status.error, dotColor: theme.colors.status.error, pillVariant: resolveConnectionStatusPillVariant(status) };
        case 'disconnected':
            return { labelKey: 'status.disconnected', color: theme.colors.status.disconnected, dotColor: theme.colors.status.disconnected, pillVariant: resolveConnectionStatusPillVariant(status) };
        default:
            return { labelKey: 'status.unknown', color: theme.colors.status.default, dotColor: theme.colors.status.default, pillVariant: resolveConnectionStatusPillVariant(status) };
    }
}

function resolveRelayStatusKey(params: Readonly<{
    endpointStatus: unknown;
    connectionHealthKind: ReturnType<typeof useConnectionHealth>['kind'];
}>): 'connected' | 'connecting' | 'disconnected' | 'error' | 'action_required' | 'unknown' {
    switch (params.endpointStatus) {
        case 'online':
            return 'connected';
        case 'connecting':
            return 'connecting';
        case 'auth_failed':
            return 'action_required';
        case 'offline':
        case 'shutting_down':
            return 'disconnected';
        case 'idle':
            switch (params.connectionHealthKind) {
                case 'healthy':
                case 'no_machine':
                case 'machine_offline':
                case 'machine_not_ready':
                    return 'connected';
                case 'connecting':
                    return 'connecting';
                case 'auth_required':
                    return 'action_required';
                case 'server_error':
                    return 'error';
                case 'server_unreachable':
                    return 'disconnected';
                default:
                    return 'unknown';
            }
        default:
            return 'unknown';
    }
}

function resolveSocketStatusKey(socketStatus: unknown): 'connected' | 'connecting' | 'disconnected' | 'error' | 'unknown' {
    switch (socketStatus) {
        case 'connected':
            return 'connected';
        case 'connecting':
            return 'connecting';
        case 'error':
            return 'error';
        case 'disconnected':
            return 'disconnected';
        default:
            return 'unknown';
    }
}

const ConnectionPopoverStatusRow = React.memo(function ConnectionPopoverStatusRow(props: Readonly<{
    testID: string;
    icon: IconName;
    title: string;
    subtitle: string;
    statusLabel: string;
    statusColor: string;
    dotColor: string;
    statusVariant: StatusPillVariant;
    onRetry?: () => void;
}>) {
    const styles = stylesheet;
    return (
        <View style={styles.statusRow} testID={props.testID}>
            <View style={styles.statusRowLeft}>
                <View style={styles.statusRowIcon}>
                    <Icon name={props.icon} size={16} color={props.dotColor} />
                </View>
                <View style={styles.statusRowText}>
                    <Text style={styles.statusRowTitle} numberOfLines={1}>
                        {props.title}
                    </Text>
                    <Text style={styles.statusRowSubtitle} numberOfLines={1} ellipsizeMode="tail">
                        {props.subtitle}
                    </Text>
                </View>
            </View>
            <View style={{ flex: 1 }} />
            <View style={styles.statusRowRight}>
                {props.onRetry ? (
                    <Pressable
                        testID={`${props.testID}-retry`}
                        accessibilityRole="button"
                        accessibilityLabel={t('common.retry')}
                        hitSlop={8}
                        onPress={props.onRetry}
                        style={styles.statusRowRetryButton}
                    >
                        <Icon name="arrow-clockwise" size={16} color={props.statusColor} />
                    </Pressable>
                ) : null}
                <StatusPill
                    variant={props.statusVariant}
                    label={props.statusLabel}
                    style={styles.popoverStatusPill}
                />
            </View>
        </View>
    );
});

export const ConnectionStatusControl = React.memo(function ConnectionStatusControl(props: {
    variant: Variant;
    textSize?: number;
    dotSize?: number;
    chevronSize?: number;
    alignSelf?: 'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline';
}) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const auth = useAuth();
    const socketStatus = useSocketStatus();
    const syncError = useSyncError();
    const lastSyncAt = useLastSyncAt();
    const connectionHealth = useConnectionHealth();
    const accountSettings = useSettings();
    const {
        serverSelectionGroups,
        serverSelectionActiveTargetKind,
        serverSelectionActiveTargetId,
        setHomeViewSelectionSettings,
    } = useHomeViewSelectionSettingsMutable(accountSettings);

    const [open, setOpen] = React.useState(false);
    const [detailsExpanded, setDetailsExpanded] = React.useState(false);
    const [pendingServerId, setPendingServerId] = React.useState<string | null>(null);
    const anchorRef = React.useRef<React.ElementRef<typeof View> | null>(null);
    const serverProfilesGeneration = useServerProfilesGeneration();
    const activeServerSnapshot = useActiveServerSnapshot();

    const textSize = props.textSize ?? (props.variant === 'sidebar' ? 11 : 12);
    const dotSize = props.dotSize ?? 6;
    const chevronSize = props.chevronSize ?? 8;

    const servers = React.useMemo(() => {
        try {
            return listServerProfiles()
                .slice();
        } catch {
            return [];
        }
    }, [serverProfilesGeneration]);
    const activeServerId = activeServerSnapshot.serverId;
    const machineListStatusByServerId = useMachineListStatusByServerId();
    const authStatusByServerId = useServerAuthStatusByServerId(servers);
    const activeSyncError = React.useMemo(() => {
        return selectSyncErrorForServer(syncError, activeServerId);
    }, [activeServerId, syncError]);

    // Keep the trigger on the applied Home until the focus transaction commits.
    // The pending target row carries the connecting state, so cached/live facts
    // from the current Home are never presented under the requested Home's name.
    const displayServerId = activeServerId;
    const displayServerProfile = React.useMemo(() => {
        return servers.find((server) => server.id === displayServerId || resolveServerProfileScopeId(server) === displayServerId) ?? null;
    }, [displayServerId, servers]);
    const displayServerUrl = displayServerProfile?.serverUrl ?? activeServerSnapshot.serverUrl;
    const activeServerLabel = React.useMemo(() => {
        const active = displayServerProfile;
        const name = String(active?.name ?? '').trim();
        if (name) return name;
        return toServerUrlDisplay(displayServerUrl) || t('status.connected');
    }, [displayServerProfile, displayServerUrl]);

    const switchServer = React.useCallback(async (
        serverId: string,
        scope: 'tab' | 'device',
    ) => {
        setPendingServerId(serverId);
        try {
            const result = await setActiveServerAndSwitch({ serverId, scope, refreshAuth: auth.refreshFromActiveServer });
            if (result !== 'blocked') {
                setOpen(false);
                setDetailsExpanded(false);
            }
            return result;
        } finally {
            setPendingServerId((current) => current === serverId ? null : current);
        }
    }, [auth]);

    const serverSelectionScopeSettings = React.useMemo(() => normalizeServerSelectionSettingsForProfileScopeIds({
        serverSelectionGroups,
        serverSelectionActiveTargetKind,
        serverSelectionActiveTargetId,
    }, servers), [
        serverSelectionActiveTargetId,
        serverSelectionActiveTargetKind,
        serverSelectionGroups,
        servers,
    ]);

    const serverTargets = React.useMemo(() => {
        return listServerSelectionTargets({
            serverProfiles: servers.map((profile) => ({
                id: resolveServerProfileScopeId(profile),
                name: profile.name,
                serverUrl: profile.serverUrl,
            })),
            groupProfiles: normalizeStoredServerSelectionGroups(serverSelectionScopeSettings.serverSelectionGroups),
        });
    }, [serverSelectionScopeSettings.serverSelectionGroups, servers]);

    const resolvedTarget = React.useMemo(() => {
        return resolveActiveServerSelectionFromRawSettings({
            activeServerId,
            availableServerIds: listServerProfileScopeIds(servers),
            settings: serverSelectionScopeSettings,
        });
    }, [
        activeServerId,
        serverSelectionScopeSettings,
        servers,
    ]);

    const activeTargetKey = React.useMemo(() => {
        return `${resolvedTarget.activeTarget.kind}:${resolvedTarget.activeTarget.id}`;
    }, [resolvedTarget.activeTarget.id, resolvedTarget.activeTarget.kind]);

    const serverById = React.useMemo(() => {
        const map = new Map<string, (typeof servers)[number]>();
        for (const server of servers) {
            map.set(server.id, server);
            map.set(resolveServerProfileScopeId(server), server);
        }
        return map;
    }, [servers]);

    const resolveTargetAuthStatus = React.useCallback(async (serverId: string) => {
        const server = serverById.get(serverId);
        if (!server) return 'unknown' as const;
        try {
            const credentials = await TokenStorage.getCredentialsForServerUrl(server.serverUrl, { serverId });
            return credentials ? 'signedIn' as const : 'signedOut' as const;
        } catch {
            return 'unknown' as const;
        }
    }, [serverById]);

    const switchTarget = React.useCallback(async (target: (typeof serverTargets)[number]) => {
        const routineSwitchScope = resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost());
        if (target.kind === 'server') {
            const server = serverById.get(target.serverId);
            if (!server) return;
            const result = await switchServer(target.serverId, routineSwitchScope);
            if (result === 'blocked') return;
            const nextTarget = buildServerSelectionActiveTargetForServer(target.serverId);
            setHomeViewSelectionSettings((current) => ({ ...current, ...nextTarget }), { targetScope: routineSwitchScope });
            if ((authStatusByServerId[target.serverId] ?? 'unknown') === 'signedOut') {
                router.replace('/');
            }
            return;
        }

        const activation = await resolveServerSelectionGroupActivation({
            currentServerId: activeServerId,
            serverIds: target.serverIds,
            resolveAuthStatus: resolveTargetAuthStatus,
        });
        const nextServerId = activation?.serverId ?? '';
        if (nextServerId && !areServerProfileIdentifiersEquivalent(nextServerId, activeServerId)) {
            const result = await switchServer(nextServerId, routineSwitchScope);
            if (result === 'blocked') return;
        }
        setHomeViewSelectionSettings((current) => ({
            ...current,
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: target.groupId,
        }), { targetScope: routineSwitchScope });
        if (nextServerId && activation?.authStatus === 'signedOut') {
            router.replace('/');
            return;
        }
        setOpen(false);
        setDetailsExpanded(false);
    }, [
        activeServerId,
        authStatusByServerId,
        router,
        resolveTargetAuthStatus,
        setHomeViewSelectionSettings,
        serverById,
        switchServer,
    ]);
    const targetStatusByServerId = React.useMemo(() => {
        const result: Record<string, { label: string }> = {};
        for (const target of serverTargets) {
            if (target.kind !== 'server') continue;
            const authStatus = authStatusByServerId[target.serverId] ?? 'unknown';
            const projectionStatus = machineListStatusByServerId[target.serverId];
            result[target.serverId] = {
                label: authStatus === 'signedOut'
                    ? t('server.signedOut')
                    : pendingServerId === target.serverId
                        ? t('status.connecting')
                        : target.serverId === activeServerId
                            ? t(connectionHealth.statusLabelKey)
                            : projectionStatus === 'idle'
                                ? t('status.connected')
                                : projectionStatus === 'loading'
                                    ? t('status.connecting')
                                    : projectionStatus === 'error'
                                        ? t('status.offline')
                                        : authStatus === 'signedIn'
                                            ? t('server.signedIn')
                                            : t('server.authStatusUnknown'),
            };
        }
        return result;
    }, [activeServerId, authStatusByServerId, connectionHealth.statusLabelKey, machineListStatusByServerId, pendingServerId, serverTargets]);
    const targetActions = useConnectionTargetActions({
        targets: serverTargets,
        activeTargetKey,
        onSelectTarget: (target) => {
            void switchTarget(target);
        },
        selectedColor: theme.colors.status.connected,
        statusByServerId: targetStatusByServerId,
    });

    const syncErrorPresentation = React.useMemo(() => {
        if (!activeSyncError) return null;
        const classified = resolveSocketErrorClassification(activeSyncError.message);
        return {
            ...classified,
            kind: activeSyncError.kind === 'auth' ? 'auth' : classified.kind,
            retryable: activeSyncError.retryable ?? classified.retryable,
            message: classified.message,
        };
    }, [activeSyncError]);

    const handleRestoreAccount = React.useCallback(() => {
        const result = runGuardedNavigation(() => router.push('/restore'));
        if (result !== true) {
            fireAndForget(result, { tag: 'ConnectionStatusControl.nav.restore' });
        }
        setOpen(false);
        setDetailsExpanded(false);
    }, [router]);

    const handleRetry = React.useCallback(() => {
        fireAndForget(retryActiveServerConnection(), {
            tag: 'ConnectionStatusControl.retryActiveServerConnection',
        });
        setOpen(false);
        setDetailsExpanded(false);
    }, []);

    const handleManageRelay = React.useCallback(() => {
        const result = runGuardedNavigation(() => router.push(RELAY_SETTINGS_ROUTE));
        if (result !== true) {
            fireAndForget(result, { tag: 'ConnectionStatusControl.nav.manageRelay' });
        }
        setOpen(false);
        setDetailsExpanded(false);
    }, [router]);
    const popoverMinWidth = props.variant === 'sidebar' && Platform.OS === 'web' ? POPOVER_MIN_WIDTH : undefined;
    const collapsedStatusLabel = t(connectionHealth.statusLabelKey);
    const collapsedStatusColor = connectionHealth.color;

    return (
        <>
            {/* Use a View wrapper for the anchor ref (stable, measurable). */}
            <View
                style={[styles.container, props.alignSelf ? { alignSelf: props.alignSelf } : null]}
                ref={anchorRef}
                collapsable={false}
            >
                <Pressable
                    style={styles.statusContainer}
                    onPress={() => setOpen((currentOpen) => {
                        if (currentOpen) setDetailsExpanded(false);
                        return !currentOpen;
                    })}
                    accessibilityRole="button"
                    accessibilityLabel={`${activeServerLabel}, ${collapsedStatusLabel}`}
                    accessibilityState={{ expanded: open }}
                >
                    <StatusDot
                        color={collapsedStatusColor}
                        isPulsing={connectionHealth.isPulsing}
                        size={dotSize}
                        style={{ marginRight: 4 }}
                    />
                    <Text
                        style={[styles.statusText, { color: collapsedStatusColor, fontSize: textSize }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                    >
                        {activeServerLabel}
                    </Text>
                    <Icon
                        name={open ? "caret-up" : "caret-down"}
                        size={chevronSize}
                        color={collapsedStatusColor}
                        style={styles.statusChevron}
                    />
                </Pressable>
                {open ? (
                    <Popover
                        open={open}
                        anchorRef={anchorRef}
                        placement="bottom"
                        edgePadding={{ horizontal: 12, vertical: 12 }}
                        portal={{
                            web: true,
                            native: true,
                            matchAnchorWidth: false,
                            anchorAlign: 'center',
                        }}
                        maxWidthCap={POPOVER_MAX_WIDTH}
                        maxHeightCap={520}
                        onRequestClose={() => {
                            setOpen(false);
                            setDetailsExpanded(false);
                        }}
                    >
                    {({ maxHeight }) => (
                        <FloatingOverlay
                            maxHeight={Math.max(220, Math.min(maxHeight, 520))}
                            keyboardShouldPersistTaps="always"
                            edgeFades={{ top: true, bottom: true, size: 18 }}
                            edgeIndicators={true}
                            containerStyle={popoverMinWidth ? { minWidth: popoverMinWidth } : null}
                        >
                            <View style={styles.popoverContent} testID="connection-popover-content">
                                <View style={styles.popoverHeader}>
                                    <Text style={styles.popoverTitle}>{t('connectionStatus.title')}</Text>
                                </View>

                                {targetActions.length > 0 ? (
                                    <View style={styles.popoverRelayBlock} testID="connection-target-list-section">
                                        <View style={styles.popoverSection}>
                                            <View style={styles.popoverSectionHeader}>
                                                <Text style={styles.popoverSectionTitle}>{t('server.changeServer')}</Text>
                                                <Pressable
                                                    testID="connection-popover-relay-settings"
                                                    accessibilityRole="button"
                                                    accessibilityLabel={t('server.changeServer')}
                                                    onPress={handleManageRelay}
                                                    style={styles.popoverSectionIconButton}
                                                >
                                                    <Icon name="sliders-horizontal" size={16} color={theme.colors.text.secondary} />
                                                </Pressable>
                                            </View>
                                        </View>

                                        <ConnectionTargetList
                                            title=""
                                            accessibilityLabel={t('server.changeServer')}
                                            actions={targetActions}
                                        />
                                    </View>
                                ) : null}

                                <Pressable
                                    testID="connection-details-disclosure"
                                    accessibilityRole="button"
                                    accessibilityLabel={t('common.details')}
                                    accessibilityState={{ expanded: detailsExpanded }}
                                    onPress={() => setDetailsExpanded((expanded) => !expanded)}
                                    style={styles.detailsDisclosure}
                                >
                                    <Text style={styles.detailsDisclosureText}>{t('common.details')}</Text>
                                    <Icon
                                        name={detailsExpanded ? 'caret-up' : 'caret-down'}
                                        size={14}
                                        color={theme.colors.text.secondary}
                                    />
                                </Pressable>

                                {detailsExpanded ? (
                                <>
                                {(() => {
                                    const relayStatusKey = resolveRelayStatusKey({
                                        endpointStatus: (connectionHealth as any).endpointStatus,
                                        connectionHealthKind: connectionHealth.kind,
                                    });
                                    const endpointPresentation = resolveStatusPresentation(theme, relayStatusKey);
                                    const canRetryRelayConnection =
                                        relayStatusKey === 'connecting'
                                        || relayStatusKey === 'disconnected'
                                        || relayStatusKey === 'error';
                                    const socketPresentation = resolveStatusPresentation(
                                        theme,
                                        resolveSocketStatusKey(socketStatus.status),
                                    );
                                    const machineCount = typeof (connectionHealth as any).machineCount === 'number'
                                        ? (connectionHealth as any).machineCount as number
                                        : 0;
                                    const onlineCount = typeof (connectionHealth as any).onlineCount === 'number'
                                        ? (connectionHealth as any).onlineCount as number
                                        : 0;
                                    const hasUnknownMachines = Boolean((connectionHealth as any).hasUnknownMachines);
                                    const primaryMachineLabel =
                                        typeof (connectionHealth as any).primaryMachineLabel === 'string'
                                            ? (connectionHealth as any).primaryMachineLabel as string
                                            : null;
                                    const machineSummary = resolveMachineConnectionSummary({
                                        machineCount,
                                        onlineCount,
                                        hasUnknownMachines,
                                        primaryMachineLabel,
                                    });

                                    const machineSubtitle = (() => {
                                        switch (machineSummary.kind) {
                                            case 'unknown':
                                                return t('status.unknown');
                                            case 'none':
                                                return t('systemStatus.machines.none');
                                            case 'single':
                                                return machineSummary.label;
                                            case 'multiple':
                                                if (machineSummary.offlineCount === 0) {
                                                    return `${machineSummary.onlineCount} ${t('status.online')}`;
                                                }
                                                return `${machineSummary.onlineCount} ${t('status.online')} · ${machineSummary.offlineCount} ${t('status.offline')}`;
                                        }
                                    })();

                                    const machinesPresentation = resolveStatusPresentation(
                                        theme,
                                        connectionHealth.kind === 'healthy'
                                            ? 'connected'
                                            : connectionHealth.kind === 'connecting'
                                              ? 'connecting'
                                              : connectionHealth.kind === 'server_error'
                                                ? 'error'
                                                : connectionHealth.kind === 'server_unreachable'
                                                  ? 'disconnected'
                                                  : connectionHealth.kind === 'auth_required'
                                                    ? 'action_required'
                                                    : connectionHealth.kind === 'no_machine'
                                                      ? 'action_required'
                                                      : connectionHealth.kind === 'machine_offline'
                                                        ? 'action_required'
                                                        : connectionHealth.kind === 'machine_not_ready'
                                                          ? 'action_required'
                                                          : 'unknown',
                                    );

                                    return (
                                        <View style={styles.popoverStatusList}>
                                            <ConnectionPopoverStatusRow
                                                testID="connection-popover-relay"
                                                icon="hard-drives"
                                                title={t('systemStatus.server.activeServer')}
                                                subtitle={toServerUrlDisplay(displayServerUrl)}
                                                statusLabel={t(endpointPresentation.labelKey)}
                                                statusColor={endpointPresentation.color}
                                                dotColor={endpointPresentation.dotColor}
                                                statusVariant={endpointPresentation.pillVariant}
                                                onRetry={canRetryRelayConnection ? handleRetry : undefined}
                                            />
                                            <ConnectionPopoverStatusRow
                                                testID="connection-popover-realtime"
                                                icon="pulse"
                                                title={t('systemStatus.ui.realtime')}
                                                subtitle={t('systemStatus.ui.socket')}
                                                statusLabel={t(socketPresentation.labelKey)}
                                                statusColor={socketPresentation.color}
                                                dotColor={socketPresentation.dotColor}
                                                statusVariant={socketPresentation.pillVariant}
                                            />
                                            <ConnectionPopoverStatusRow
                                                testID="connection-popover-machines"
                                                icon="laptop"
                                                title={t('settings.machines')}
                                                subtitle={machineSubtitle}
                                                statusLabel={t(connectionHealth.machineLabelKey)}
                                                statusColor={machinesPresentation.color}
                                                dotColor={machinesPresentation.dotColor}
                                                statusVariant={machinesPresentation.pillVariant}
                                            />
                                        </View>
                                    );
                                })()}

                                <View style={styles.statusMeta}>
                                    <View style={styles.statusMetaRow}>
                                        <Text style={styles.statusMetaLabel}>
                                            {t('connectionStatus.labels.lastSync')}
                                        </Text>
                                        <Text style={styles.statusMetaValue}>
                                            {formatTime(lastSyncAt)}
                                        </Text>
                                    </View>
                                    {syncErrorPresentation ? (
                                        <View style={styles.statusMetaRow}>
                                            <Text style={styles.statusMetaLabel}>
                                                {t('connectionStatus.labels.lastError')}
                                            </Text>
                                            <Text style={[styles.statusMetaValue, { flexShrink: 1, textAlign: 'right' }]} numberOfLines={2}>
                                                {syncErrorPresentation.message}
                                            </Text>
                                        </View>
                                    ) : null}
                                </View>

                                {syncErrorPresentation ? (
                                    <View style={styles.popoverActionsRow}>
                                        {syncErrorPresentation.kind === 'auth' ? (
                                            <Pressable
                                                onPress={handleRestoreAccount}
                                                style={styles.popoverActionButton}
                                                accessibilityRole="button"
                                            >
                                                <Text style={styles.popoverActionButtonText}>{t('connect.restoreAccount')}</Text>
                                            </Pressable>
                                        ) : syncErrorPresentation.retryable !== false ? (
                                            <Pressable
                                                onPress={handleRetry}
                                                style={styles.popoverActionButton}
                                                accessibilityRole="button"
                                            >
                                                <Text style={styles.popoverActionButtonText}>{t('common.retry')}</Text>
                                            </Pressable>
                                        ) : null}
                                    </View>
                                ) : null}
                                </>
                                ) : null}
                            </View>
                        </FloatingOverlay>
                    )}
                    </Popover>
                ) : null}
            </View>

        </>
    );
});
