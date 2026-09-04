import * as React from 'react';
import { Platform, View, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { t, type TranslationKeyNoParams } from '@/text';
import { StatusDot } from '@/components/ui/status/StatusDot';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status/StatusPill';
import { Popover } from '@/components/ui/popover';
import { FloatingOverlay } from '@/components/ui/overlays/FloatingOverlay';
import { useSocketStatus, useSyncError, useLastSyncAt, useMachineListStatusByServerId } from '@/sync/domains/state/storage';
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
import {
    getAppliedActiveServerId,
    retryActiveServerConnection,
    subscribeAppliedActiveServer,
} from '@/sync/runtime/orchestration/connectionManager';
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
import {
    readIrohHomeTransportDiagnostics,
    readIrohHomeTransportDiagnosticsRevision,
    subscribeIrohHomeTransportDiagnostics,
} from '@/sync/runtime/irohHomeTransportDiagnostics';
import { resolveHomeConnectionSummary } from '@/components/navigation/connectionStatus/resolveHomeConnectionSummary';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';
import type { DoctorSnapshotHomeTransportDiagnostics } from '@happier-dev/protocol';
import { CopiedPill } from '@/components/ui/copy/CopiedPill';

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
    technicalDetails: {
        marginHorizontal: 16,
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        backgroundColor: theme.colors.surface.inset,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        gap: 8,
    },
    technicalDetailsTitle: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.default('semiBold'),
    },
    technicalDetailsValue: {
        fontSize: 11,
        lineHeight: 16,
        color: theme.colors.text.secondary,
        ...Typography.mono(),
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
    copyDiagnosticsButton: {
        minHeight: minimumInteractiveTargetSize,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
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

type TransportDetailRow = Readonly<{ key: string; label: string; value: string }>;

/**
 * Advanced transport facts, presented as labeled rows rather than a raw JSON
 * dump so support and expert users can read, translate, and scan them. The
 * exact same rows compose the copyable report; there is no second formatter.
 */
function buildTransportDetailRows(params: Readonly<{
    homeServerIdentityId: string | null;
    canonicalServerUrl: string;
    publicServerUrl: string | null | undefined;
    runtimeOrigin: string | null;
    diagnostics: DoctorSnapshotHomeTransportDiagnostics | null;
    carrier: 'https' | 'iroh' | undefined;
}>): readonly TransportDetailRow[] {
    const rows: TransportDetailRow[] = [];
    if (params.homeServerIdentityId) {
        rows.push({
            key: 'homeIdentity',
            label: t('connectionStatus.labels.homeIdentity'),
            value: params.homeServerIdentityId,
        });
    }
    if (params.canonicalServerUrl) {
        rows.push({
            key: 'canonicalAddress',
            label: t('connectionStatus.labels.canonicalAddress'),
            value: params.canonicalServerUrl,
        });
    }
    if (params.publicServerUrl !== undefined) {
        rows.push({
            key: 'publicIngress',
            label: t('connectionStatus.labels.publicIngress'),
            value: params.publicServerUrl === null
                ? t('connectionStatus.values.publicIngressAbsent')
                : params.publicServerUrl,
        });
    }
    if (params.runtimeOrigin && params.runtimeOrigin !== params.canonicalServerUrl) {
        rows.push({
            key: 'runtimeOrigin',
            label: t('connectionStatus.labels.runtimeOrigin'),
            value: params.runtimeOrigin,
        });
    }
    const diagnostics = params.diagnostics;
    if (diagnostics?.remoteEndpointId) {
        rows.push({
            key: 'endpointId',
            label: t('connectionStatus.labels.endpointId'),
            value: diagnostics.remoteEndpointId,
        });
    }
    if (params.carrier) {
        rows.push({
            key: 'effectiveCarrier',
            label: t('connectionStatus.labels.effectiveCarrier'),
            value: params.carrier === 'iroh' ? 'Iroh' : 'HTTPS',
        });
    }
    const appendPathRow = (
        key: 'currentPath' | 'lastKnownPath',
        observation: NonNullable<DoctorSnapshotHomeTransportDiagnostics['current']>,
    ) => {
        const pathLabel = observation.observedPath === 'direct'
            ? t('connectionStatus.values.pathDirect')
            : observation.observedPath === 'relay'
                ? t('connectionStatus.values.pathRelay')
                : t('status.unknown');
        rows.push({
            key,
            label: key === 'currentPath'
                ? t('connectionStatus.labels.currentPath')
                : t('connectionStatus.labels.lastKnownPath'),
            value: observation.carrier
                ? `${observation.carrier === 'iroh' ? 'Iroh' : 'HTTPS'} · ${pathLabel}`
                : pathLabel,
        });
    };
    if (diagnostics?.current) appendPathRow('currentPath', diagnostics.current);
    if (diagnostics?.lastKnown) appendPathRow('lastKnownPath', diagnostics.lastKnown);
    const configuration = diagnostics?.effectiveConfiguration;
    if (configuration) {
        rows.push({
            key: 'relayConfiguration',
            label: t('connectionStatus.labels.relayConfiguration'),
            value: configuration.policy === 'disabled'
                ? t('connectionStatus.values.relayDisabled')
                : t('connectionStatus.values.relayAutomatic', {
                    relays: configuration.relayUrls.join(', ') || t('status.unknown'),
                    direct: configuration.directAddressCount,
                }),
        });
    }
    if (diagnostics?.diagnosticError) {
        const { code, message } = diagnostics.diagnosticError;
        rows.push({
            key: 'transportError',
            label: t('connectionStatus.labels.transportError'),
            value: message ? `${code}: ${message}` : code,
        });
    }
    if (diagnostics?.lastTransitionAtMs !== undefined) {
        rows.push({
            key: 'lastTransition',
            label: t('connectionStatus.labels.lastTransition'),
            value: formatTime(diagnostics.lastTransitionAtMs),
        });
    }
    return rows;
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

type ConnectionTarget = ReturnType<typeof listServerSelectionTargets>[number];

const ConnectionPopoverTargets = React.memo(function ConnectionPopoverTargets(props: Readonly<{
    servers: ReturnType<typeof listServerProfiles>;
    targets: readonly ConnectionTarget[];
    activeTargetKey: string;
    activeServerId: string;
    displayServerId: string;
    pendingServerId: string | null;
    connectionStatusLabelKey: TranslationKeyNoParams;
    selectedColor: string;
    switchServer: (
        serverId: string,
        scope: 'tab' | 'device',
    ) => ReturnType<typeof setActiveServerAndSwitch>;
    setHomeViewSelectionSettings: ReturnType<typeof useHomeViewSelectionSettingsMutable>['setHomeViewSelectionSettings'];
    onClose: () => void;
    onManageRelay: () => void;
}>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const router = useRouter();
    const machineListStatusByServerId = useMachineListStatusByServerId();
    const authStatusByServerId = useServerAuthStatusByServerId(props.servers);
    const serverById = React.useMemo(() => {
        const map = new Map<string, (typeof props.servers)[number]>();
        for (const server of props.servers) {
            map.set(server.id, server);
            map.set(resolveServerProfileScopeId(server), server);
        }
        return map;
    }, [props.servers]);

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

    const switchTarget = React.useCallback(async (target: ConnectionTarget) => {
        const routineSwitchScope = resolveRoutineServerSelectionScope(Platform.OS, isDesktopHost());
        if (target.kind === 'server') {
            const server = serverById.get(target.serverId);
            if (!server) return;
            const result = await props.switchServer(target.serverId, routineSwitchScope);
            if (result === 'blocked') return;
            const nextTarget = buildServerSelectionActiveTargetForServer(target.serverId);
            props.setHomeViewSelectionSettings(
                (current) => ({ ...current, ...nextTarget }),
                { targetScope: routineSwitchScope },
            );
            if ((authStatusByServerId[target.serverId] ?? 'unknown') === 'signedOut') {
                router.replace('/');
            }
            return;
        }

        const activation = await resolveServerSelectionGroupActivation({
            currentServerId: props.activeServerId,
            serverIds: target.serverIds,
            resolveAuthStatus: resolveTargetAuthStatus,
        });
        const nextServerId = activation?.serverId ?? '';
        if (nextServerId && !areServerProfileIdentifiersEquivalent(nextServerId, props.activeServerId)) {
            const result = await props.switchServer(nextServerId, routineSwitchScope);
            if (result === 'blocked') return;
        }
        props.setHomeViewSelectionSettings((current) => ({
            ...current,
            serverSelectionActiveTargetKind: 'group',
            serverSelectionActiveTargetId: target.groupId,
        }), { targetScope: routineSwitchScope });
        if (nextServerId && activation?.authStatus === 'signedOut') {
            router.replace('/');
            return;
        }
        props.onClose();
    }, [
        authStatusByServerId,
        props,
        resolveTargetAuthStatus,
        router,
        serverById,
    ]);

    const targetStatusByServerId = React.useMemo(() => {
        const result: Record<string, { label: string }> = {};
        for (const target of props.targets) {
            if (target.kind !== 'server') continue;
            const authStatus = authStatusByServerId[target.serverId] ?? 'unknown';
            const projectionStatus = machineListStatusByServerId[target.serverId];
            result[target.serverId] = {
                label: authStatus === 'signedOut'
                    ? t('server.signedOut')
                    : props.pendingServerId === target.serverId
                        ? t('status.connecting')
                        : areServerProfileIdentifiersEquivalent(target.serverId, props.displayServerId)
                            ? t(props.connectionStatusLabelKey)
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
    }, [
        authStatusByServerId,
        machineListStatusByServerId,
        props.connectionStatusLabelKey,
        props.displayServerId,
        props.pendingServerId,
        props.targets,
    ]);
    const targetActions = useConnectionTargetActions({
        targets: props.targets,
        activeTargetKey: props.activeTargetKey,
        onSelectTarget: (target) => {
            void switchTarget(target);
        },
        selectedColor: props.selectedColor,
        statusByServerId: targetStatusByServerId,
    });

    if (targetActions.length === 0) return null;
    return (
        <View style={styles.popoverRelayBlock} testID="connection-target-list-section">
            <View style={styles.popoverSection}>
                <View style={styles.popoverSectionHeader}>
                    <Text style={styles.popoverSectionTitle}>{t('server.changeServer')}</Text>
                    <Pressable
                        testID="connection-popover-relay-settings"
                        accessibilityRole="button"
                        accessibilityLabel={t('server.changeServer')}
                        onPress={props.onManageRelay}
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
    const {
        serverSelectionGroups,
        serverSelectionActiveTargetKind,
        serverSelectionActiveTargetId,
        setHomeViewSelectionSettings,
    } = useHomeViewSelectionSettingsMutable();

    const [open, setOpen] = React.useState(false);
    const [detailsExpanded, setDetailsExpanded] = React.useState(false);
    const [diagnosticsCopied, setDiagnosticsCopied] = React.useState(false);
    const [pendingServerId, setPendingServerId] = React.useState<string | null>(null);
    const anchorRef = React.useRef<React.ElementRef<typeof View> | null>(null);
    const triggerRef = React.useRef<React.ElementRef<typeof Pressable> | null>(null);
    const serverProfilesGeneration = useServerProfilesGeneration();
    const activeServerSnapshot = useActiveServerSnapshot();
    const appliedServerId = React.useSyncExternalStore(
        React.useCallback((listener) => subscribeAppliedActiveServer(() => listener()), []),
        getAppliedActiveServerId,
        getAppliedActiveServerId,
    );

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
    // Keep the trigger on the applied Home until the focus transaction commits.
    // The pending target row carries the connecting state, so cached/live facts
    // from the current Home are never presented under the requested Home's name.
    const displayServerId = appliedServerId || activeServerId;
    const displayUsesActiveSnapshot = areServerProfileIdentifiersEquivalent(displayServerId, activeServerId);
    const activeSyncError = React.useMemo(() => {
        return selectSyncErrorForServer(syncError, displayServerId);
    }, [displayServerId, syncError]);
    const displayServerProfile = React.useMemo(() => {
        return servers.find((server) => server.id === displayServerId || resolveServerProfileScopeId(server) === displayServerId) ?? null;
    }, [displayServerId, servers]);
    const displayServerUrl = displayServerProfile?.serverUrl
        ?? (displayUsesActiveSnapshot ? activeServerSnapshot.serverUrl : '');
    const diagnosticsHomeIdentity = displayServerProfile?.serverIdentityId ?? displayServerId;
    const subscribeTransportDiagnostics = React.useCallback((listener: () => void) => (
        detailsExpanded ? subscribeIrohHomeTransportDiagnostics(listener) : () => undefined
    ), [detailsExpanded]);
    const readTransportDiagnosticsRevision = React.useCallback(
        () => detailsExpanded ? readIrohHomeTransportDiagnosticsRevision() : 0,
        [detailsExpanded],
    );
    // Only the open Advanced section observes transport facts. Routine health
    // remains owned by useConnectionHealth and path changes stay silent while
    // Details is collapsed.
    const transportDiagnosticsRevision = React.useSyncExternalStore(
        subscribeTransportDiagnostics,
        readTransportDiagnosticsRevision,
        readTransportDiagnosticsRevision,
    );
    const transportDiagnostics = React.useMemo(() => detailsExpanded
        ? readIrohHomeTransportDiagnostics().find(
            (entry) => entry.homeServerIdentityId === diagnosticsHomeIdentity,
        ) ?? null
        : null, [detailsExpanded, diagnosticsHomeIdentity, transportDiagnosticsRevision]);
    React.useEffect(() => {
        setDiagnosticsCopied(false);
    }, [activeServerSnapshot.generation, diagnosticsHomeIdentity]);
    const toggleDetails = React.useCallback(() => {
        setDiagnosticsCopied(false);
        setDetailsExpanded((expanded) => !expanded);
    }, []);
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

    // First popover layer: this Home's identity and whether it is reachable
    // right now. Socket, machine, and transport facts stay behind Advanced.
    const homeSummary = React.useMemo(() => resolveHomeConnectionSummary({
        healthKind: connectionHealth.kind,
        syncErrorKind: syncErrorPresentation?.kind ?? null,
        syncErrorRetryable: syncErrorPresentation?.retryable ?? null,
    }), [connectionHealth.kind, syncErrorPresentation]);

    const homeSummaryPresentation = resolveStatusPresentation(theme, homeSummary.statusKey);

    const machineSubtitle = React.useMemo(() => {
        const summary = resolveMachineConnectionSummary({
            machineCount: connectionHealth.machineCount,
            onlineCount: connectionHealth.onlineCount,
            hasUnknownMachines: connectionHealth.hasUnknownMachines,
            primaryMachineLabel: connectionHealth.primaryMachineLabel,
        });
        switch (summary.kind) {
            case 'unknown':
                return t('status.unknown');
            case 'none':
                return t('systemStatus.machines.none');
            case 'single':
                return summary.label;
            case 'multiple':
                return summary.offlineCount === 0
                    ? `${summary.onlineCount} ${t('status.online')}`
                    : `${summary.onlineCount} ${t('status.online')} · ${summary.offlineCount} ${t('status.offline')}`;
        }
    }, [
        connectionHealth.hasUnknownMachines,
        connectionHealth.machineCount,
        connectionHealth.onlineCount,
        connectionHealth.primaryMachineLabel,
    ]);

    const canonicalServerUrl = displayServerProfile?.canonicalServerUrl ?? displayServerUrl;
    const transportDetailRows = React.useMemo(() => buildTransportDetailRows({
        homeServerIdentityId: displayServerProfile?.serverIdentityId ?? (displayUsesActiveSnapshot ? activeServerSnapshot.serverId : null),
        canonicalServerUrl,
        publicServerUrl: displayServerProfile?.publicServerUrl,
        runtimeOrigin: displayUsesActiveSnapshot ? activeServerSnapshot.runtimeOrigin ?? null : null,
        diagnostics: transportDiagnostics,
        carrier: displayUsesActiveSnapshot ? activeServerSnapshot.carrier : undefined,
    }), [
        activeServerSnapshot.carrier,
        activeServerSnapshot.runtimeOrigin,
        canonicalServerUrl,
        displayUsesActiveSnapshot,
        displayServerProfile?.publicServerUrl,
        displayServerProfile?.serverIdentityId,
        activeServerSnapshot.serverId,
        transportDiagnostics,
    ]);

    const handleCopyDiagnostics = React.useCallback(() => {
        const report = [
            `${t('connectionStatus.title')}: ${activeServerLabel} — ${t(homeSummary.statusLabelKey)}`,
            ...transportDetailRows.map((row) => `${row.label}: ${row.value}`),
            `${t('systemStatus.ui.socket')}: ${socketStatus.status}`,
            `${t('settings.machines')}: ${machineSubtitle}`,
            `${t('connectionStatus.labels.lastSync')}: ${formatTime(lastSyncAt)}`,
            ...(syncErrorPresentation ? [`${t('connectionStatus.labels.lastError')}: ${syncErrorPresentation.message}`] : []),
        ].join('\n');
        fireAndForget(setClipboardStringSafe(report).then((copied) => {
            if (copied) setDiagnosticsCopied(true);
        }), { tag: 'ConnectionStatusControl.copyDiagnostics' });
    }, [
        activeServerLabel,
        homeSummary.statusLabelKey,
        lastSyncAt,
        machineSubtitle,
        socketStatus.status,
        syncErrorPresentation,
        transportDetailRows,
    ]);

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
    const collapsedStatusLabel = t(homeSummary.statusLabelKey);
    const collapsedStatusColor = connectionHealth.color;
    // DESIGN.md forbids color as the only carrier of meaning. For states that
    // truly need attention (canonical health tone), the collapsed trigger swaps
    // its bare dot for a warning glyph carrying the same status color — one
    // quiet non-color cue. Routine connected/connecting stays dot-only and
    // transport-neutral; detail remains inside the popover.
    const collapsedShowsAttentionCue =
        connectionHealth.tone === 'attention' || connectionHealth.tone === 'danger';

    return (
        <>
            {/* Use a View wrapper for the anchor ref (stable, measurable). */}
            <View
                style={[styles.container, props.alignSelf ? { alignSelf: props.alignSelf } : null]}
                ref={anchorRef}
                collapsable={false}
            >
                <Pressable
                    ref={triggerRef}
                    style={styles.statusContainer}
                    onPress={() => setOpen((currentOpen) => {
                        if (currentOpen) {
                            setDetailsExpanded(false);
                            setDiagnosticsCopied(false);
                        }
                        return !currentOpen;
                    })}
                    accessibilityRole="button"
                    accessibilityLabel={`${activeServerLabel}, ${collapsedStatusLabel}`}
                    accessibilityState={{ expanded: open }}
                >
                    {collapsedShowsAttentionCue ? (
                        <Icon
                            name="warning"
                            size={dotSize + 4}
                            color={collapsedStatusColor}
                            style={{ marginRight: 4 }}
                        />
                    ) : (
                        <StatusDot
                            color={collapsedStatusColor}
                            isPulsing={connectionHealth.isPulsing}
                            size={dotSize}
                            style={{ marginRight: 4 }}
                        />
                    )}
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
                        focusReturnRef={triggerRef}
                        autoFocusOnOpen
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
                            setDiagnosticsCopied(false);
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

                                <View style={styles.popoverStatusList}>
                                    <ConnectionPopoverStatusRow
                                        testID="connection-popover-home"
                                        icon="house"
                                        title={activeServerLabel}
                                        subtitle={toServerUrlDisplay(displayServerUrl)}
                                        statusLabel={t(homeSummary.statusLabelKey)}
                                        statusColor={homeSummaryPresentation.color}
                                        dotColor={homeSummaryPresentation.dotColor}
                                        statusVariant={homeSummaryPresentation.pillVariant}
                                    />
                                </View>

                                {homeSummary.action !== 'none' ? (
                                    <View style={styles.popoverActionsRow}>
                                        <Pressable
                                            testID="connection-popover-primary-action"
                                            onPress={homeSummary.action === 'restore' ? handleRestoreAccount : handleRetry}
                                            style={styles.popoverActionButton}
                                            accessibilityRole="button"
                                        >
                                            <Text style={styles.popoverActionButtonText}>
                                                {homeSummary.action === 'restore'
                                                    ? t('connect.restoreAccount')
                                                    : t('common.retry')}
                                            </Text>
                                        </Pressable>
                                        <CopiedPill
                                            visible={diagnosticsCopied}
                                            testID="connection-copy-diagnostics-feedback"
                                        />
                                    </View>
                                ) : null}

                                <ConnectionPopoverTargets
                                    servers={servers}
                                    targets={serverTargets}
                                    activeTargetKey={activeTargetKey}
                                    activeServerId={activeServerId}
                                    displayServerId={displayServerId}
                                    pendingServerId={pendingServerId}
                                    connectionStatusLabelKey={connectionHealth.statusLabelKey}
                                    selectedColor={theme.colors.status.connected}
                                    switchServer={switchServer}
                                    setHomeViewSelectionSettings={setHomeViewSelectionSettings}
                                    onClose={() => {
                                        setOpen(false);
                                        setDetailsExpanded(false);
                                    }}
                                    onManageRelay={handleManageRelay}
                                />

                                <Pressable
                                    testID="connection-details-disclosure"
                                    accessibilityRole="button"
                                    accessibilityLabel={t('common.details')}
                                    accessibilityState={{ expanded: detailsExpanded }}
                                    onPress={toggleDetails}
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
                                        endpointStatus: connectionHealth.endpointStatus,
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

                                {transportDetailRows.length > 0 ? (
                                    <View style={styles.technicalDetails} testID="connection-transport-diagnostics">
                                        <Text style={styles.technicalDetailsTitle}>
                                            {t('terminal.connectionDetails')}
                                        </Text>
                                        {transportDetailRows.map((row) => (
                                            <View key={row.key} style={styles.statusMetaRow}>
                                                <Text style={styles.statusMetaLabel}>{row.label}</Text>
                                                <Text
                                                    style={[styles.technicalDetailsValue, { flexShrink: 1, textAlign: 'right' }]}
                                                    selectable
                                                >
                                                    {row.value}
                                                </Text>
                                            </View>
                                        ))}
                                        <Pressable
                                            testID="connection-copy-diagnostics"
                                            accessibilityRole="button"
                                            accessibilityLabel={diagnosticsCopied
                                                ? t('connectionStatus.diagnosticsCopied')
                                                : t('connectionStatus.copyDiagnostics')}
                                            onPress={handleCopyDiagnostics}
                                            style={styles.copyDiagnosticsButton}
                                        >
                                            <Icon
                                                name={diagnosticsCopied ? 'check' : 'copy'}
                                                size={14}
                                                color={theme.colors.text.secondary}
                                            />
                                            <Text style={styles.detailsDisclosureText}>
                                                {diagnosticsCopied
                                                    ? t('connectionStatus.diagnosticsCopied')
                                                    : t('connectionStatus.copyDiagnostics')}
                                            </Text>
                                        </Pressable>
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
