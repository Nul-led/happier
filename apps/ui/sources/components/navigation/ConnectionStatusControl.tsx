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
    getActiveServerHomeCarrier,
    listServerProfiles,
    resolveServerProfileScopeId,
} from '@/sync/domains/server/serverProfiles';
import type { HomeCarrier } from '@/sync/runtime/homeCarrier';
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
import { useActiveHomeConnectionHealth } from '@/components/navigation/connectionStatus/useConnectionHealth';
import type { ConnectionHealthKind } from '@/components/navigation/connectionStatus/connectionHealthTypes';
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
import { formatIrohRelayConfiguration } from '@/components/navigation/connectionStatus/formatIrohRelayConfiguration';
import { resolveHomeConnectionSummary, resolveHomeTargetSummary } from '@/components/navigation/connectionStatus/resolveHomeConnectionSummary';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';
import {
    sanitizeDoctorDiagnosticText,
    type DoctorSnapshotHomeTransportDiagnostics,
} from '@happier-dev/protocol';
import { CopiedPill } from '@/components/ui/copy/CopiedPill';
import { ActionListSection } from '@/components/ui/lists/ActionListSection';
import { useAccountServiceEntryOptions } from '@/components/account/auth/useAccountServiceEntryOptions';
import { useServerFeaturesSnapshotForServerId } from '@/sync/domains/features/featureDecisionRuntime';
import { buildAuthenticatedAccountEntryHref } from '@/components/navigation/accountEntry/authenticatedAccountEntryRoute';
import { accountDirectoryCredentialStorage } from '@/auth/accountDirectory/accountDirectoryCredentialStorage';
import {
    createAccountDirectoryServiceKey,
    createAccountDirectorySession,
    type AccountDirectorySession,
} from '@/sync/domains/accountDirectory/accountDirectorySession';

type Variant = 'sidebar' | 'header';
const RELAY_SETTINGS_ROUTE = '/settings/server';
const POPOVER_MAX_WIDTH = 420;
const POPOVER_MIN_WIDTH = 220;
const DENSE_POINTER_TARGET_SIZE = 24;
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
    },
    headerStatusContainer: {
        minHeight: minimumInteractiveTargetSize,
    },
    sidebarStatusContainer: {
        // Keep the 0.2 line-box geometry while giving React Native Web a real
        // pointer frame. Pressable does not implement hitSlop on web.
        minHeight: DENSE_POINTER_TARGET_SIZE,
        marginTop: -6,
        marginBottom: -4,
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
        paddingBottom: 10,
    },
    popoverTitle: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.default('semiBold'),
        textTransform: 'uppercase',
    },
    popoverStatusList: {
        marginHorizontal: 12,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
        overflow: 'hidden',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 54,
        paddingVertical: 9,
        paddingHorizontal: 12,
        position: 'relative',
    },
    statusRowDivider: {
        position: 'absolute',
        top: 0,
        left: 44,
        right: 12,
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.colors.border.default,
    },
    statusRowLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flexShrink: 1,
        minWidth: 0,
    },
    statusRowIcon: {
        width: 22,
        height: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    statusRowText: {
        flexShrink: 1,
        minWidth: 0,
    },
    statusRowTitle: {
        fontSize: 13,
        color: theme.colors.text.primary,
        ...Typography.default('semiBold'),
        lineHeight: 17,
    },
    statusRowSubtitle: {
        fontSize: 12,
        color: theme.colors.text.secondary,
        ...Typography.default(),
        lineHeight: 16,
        marginTop: 1,
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
        marginHorizontal: 12,
        marginTop: 4,
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
        marginHorizontal: 12,
        marginTop: 6,
        paddingHorizontal: 8,
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
    if (diagnostics?.lastKnown && (
        !diagnostics.current
        || diagnostics.lastKnown.carrier !== diagnostics.current.carrier
        || diagnostics.lastKnown.observedPath !== diagnostics.current.observedPath
    )) appendPathRow('lastKnownPath', diagnostics.lastKnown);
    const configuration = diagnostics?.effectiveConfiguration;
    if (configuration) {
        rows.push({
            key: 'relayConfiguration',
            label: t('connectionStatus.labels.relayConfiguration'),
            value: formatIrohRelayConfiguration(configuration),
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
    // These rows are rendered and copied. Sanitize once at their shared owner
    // so neither surface can disclose bearer material, URL credentials, or
    // secret-shaped values emitted by a transport boundary.
    return rows.map((row) => ({
        ...row,
        value: sanitizeDoctorDiagnosticText(row.value),
    }));
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
    connectionHealthKind: ConnectionHealthKind;
    transportState?: DoctorSnapshotHomeTransportDiagnostics['state'];
}>): 'connected' | 'connecting' | 'disconnected' | 'error' | 'action_required' | 'unknown' {
    switch (params.transportState) {
        case 'connected': return 'connected';
        case 'connecting':
        case 'reconnecting': return 'connecting';
        case 'unavailable': return 'error';
        case 'disconnected': return 'disconnected';
    }
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

function resolveMachineStatusKey(kind: ConnectionHealthKind): ConnectionStatusKey {
    switch (kind) {
        case 'healthy':
            return 'connected';
        case 'connecting':
            return 'connecting';
        case 'server_error':
            return 'error';
        case 'server_unreachable':
            return 'disconnected';
        case 'auth_required':
        case 'no_machine':
        case 'machine_offline':
        case 'machine_not_ready':
            return 'action_required';
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
    divided?: boolean;
    onRetry?: () => void;
}>) {
    const styles = stylesheet;
    return (
        <View style={styles.statusRow} testID={props.testID}>
            {props.divided ? <View pointerEvents="none" style={styles.statusRowDivider} /> : null}
            <View style={styles.statusRowLeft}>
                <View style={styles.statusRowIcon}>
                    <Icon name={props.icon} size={17} color={props.dotColor} />
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
            await props.setHomeViewSelectionSettings(
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
        await props.setHomeViewSelectionSettings((current) => ({
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
            const isDisplayedHome = areServerProfileIdentifiersEquivalent(target.serverId, props.displayServerId);
            const summary = isDisplayedHome
                ? null
                : resolveHomeTargetSummary({
                    authStatus,
                    projectionStatus,
                    pending: props.pendingServerId === target.serverId,
                });
            result[target.serverId] = {
                label: t(summary?.statusLabelKey ?? props.connectionStatusLabelKey),
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
                        accessibilityLabel={t('server.serverConfiguration')}
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

const ConnectionPopoverAccountEntryActions = React.memo(function ConnectionPopoverAccountEntryActions(props: Readonly<{
    profile: ReturnType<typeof listServerProfiles>[number] | null;
    runtimeOrigin: string | null;
    homeCarrier: HomeCarrier | null;
    onClose: () => void;
}>) {
    const router = useRouter();
    const launchingRef = React.useRef(false);
    const profile = props.profile;
    const profileScopeId = profile ? resolveServerProfileScopeId(profile) : '';
    const featuresSnapshot = useServerFeaturesSnapshotForServerId(profileScopeId, { enabled: Boolean(profile) });
    const targetContext = React.useMemo(() => {
        if (!profile) return { kind: 'none' as const };
        return {
            kind: 'home' as const,
            target: { kind: 'saved_profile' as const, profileRef: profile.id },
            ...(featuresSnapshot.status === 'ready' && featuresSnapshot.features.signInService
                ? { policy: featuresSnapshot.features.signInService }
                : {}),
            selfService: {
                endpointUrl: profile.canonicalServerUrl ?? profile.serverUrl,
                ...(profile.serverIdentityId ? { expectedServerIdentityId: profile.serverIdentityId } : {}),
                ...(props.runtimeOrigin ? { runtimeOrigin: props.runtimeOrigin } : {}),
                ...(props.homeCarrier ? { homeCarrier: props.homeCarrier } : {}),
            },
        };
    }, [featuresSnapshot, profile, props.homeCarrier, props.runtimeOrigin]);
    const entry = useAccountServiceEntryOptions(targetContext);
    const discovery = entry.status === 'ready' ? entry.discovery : null;
    const currentHomeServerIdentityId = profile?.serverIdentityId?.trim() || null;
    const discoveredServiceKey = discovery ? createAccountDirectoryServiceKey({
        endpoint: discovery.endpointUrl,
        serverIdentityId: discovery.serverIdentityId,
    }) : null;
    const [directorySessionBinding, setDirectorySessionBinding] = React.useState<Readonly<{
        serviceKey: string;
        session: AccountDirectorySession;
    }> | null>(null);
    const [signedIn, setSignedIn] = React.useState(false);
    const directorySession = directorySessionBinding?.serviceKey === discoveredServiceKey
        ? directorySessionBinding.session
        : null;
    const subscribeDirectorySession = React.useCallback((listener: () => void) => (
        directorySession?.subscribe(() => listener()) ?? (() => {})
    ), [directorySession]);
    const getDirectorySnapshot = React.useCallback(() => directorySession?.snapshot ?? null, [directorySession]);
    const directorySnapshot = React.useSyncExternalStore(
        subscribeDirectorySession,
        getDirectorySnapshot,
        getDirectorySnapshot,
    );

    React.useEffect(() => {
        let cancelled = false;
        setSignedIn(false);
        setDirectorySessionBinding(null);
        if (!discovery || !discoveredServiceKey) return () => { cancelled = true; };

        void (async () => {
            try {
                const target = {
                    endpoint: discovery.endpointUrl,
                    serverIdentityId: discovery.serverIdentityId,
                };
                const credentials = await accountDirectoryCredentialStorage.get(target);
                if (cancelled || !credentials) return;
                const session = createAccountDirectorySession(target, {
                    capability: discovery.capability,
                    transport: entry.transport,
                });
                setDirectorySessionBinding({ serviceKey: discoveredServiceKey, session });
                setSignedIn(true);
                await session.refresh();
            } catch {
                if (!cancelled) {
                    setSignedIn(false);
                    setDirectorySessionBinding(null);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [discoveredServiceKey, discovery, entry.transport]);

    const openEntry = React.useCallback((intent: Parameters<typeof buildAuthenticatedAccountEntryHref>[0]['intent']) => {
        if (!discovery || launchingRef.current) return;
        launchingRef.current = true;
        const href = buildAuthenticatedAccountEntryHref({
            service: {
                endpointUrl: discovery.endpointUrl,
                serverIdentityId: discovery.serverIdentityId,
            },
            intent,
            returnTo: '/',
        });
        props.onClose();
        const navigation = runGuardedNavigation(() => router.push(href));
        if (navigation !== true) {
            fireAndForget(navigation, { tag: 'ConnectionStatusControl.nav.accountEntry' });
        }
    }, [discovery, props, router]);

    const signOut = React.useCallback(async () => {
        if (!directorySession) return;
        const removed = await directorySession.logout();
        if (!removed) return;
        setSignedIn(false);
        setDirectorySessionBinding(null);
    }, [directorySession]);

    const serviceName = discovery?.accountServiceDisplayName?.trim()
        || (discovery ? toServerUrlDisplay(discovery.endpointUrl) : '');
    const currentHomeIsLinked = currentHomeServerIdentityId
        ? directorySnapshot?.homes.some((home) => home.homeServerIdentityId === currentHomeServerIdentityId) === true
        : false;
    // A loading, unreachable or unsupported sign-in service used to erase the
    // whole service area of the popover — no signal, no retry. The Home actions
    // below stay usable either way; this row only says what happened.
    const serviceNotice = React.useMemo(() => {
        if (entry.status === 'ready' || entry.status === 'not_offered') return null;
        const endpointName = entry.endpoint?.displayName?.trim() || (entry.endpoint?.url ? toServerUrlDisplay(entry.endpoint.url) : '');
        if (entry.status === 'loading') {
            return {
                id: 'account-service-notice',
                testID: 'connection-popover-account-service-notice',
                label: t('common.loading'),
                subtitle: endpointName,
            };
        }
        return {
            id: 'account-service-notice',
            testID: 'connection-popover-account-service-notice',
            label: entry.status === 'unsupported'
                ? t('welcome.signInServiceUnsupportedTitle')
                : t('welcome.signInServiceUnavailableTitle'),
            subtitle: entry.status === 'unsupported'
                ? t('welcome.signInServiceUnsupportedBody')
                : t('welcome.signInServiceUnavailableBody', { serverUrl: endpointName }),
            onPress: entry.retry,
        };
    }, [entry.endpoint?.displayName, entry.endpoint?.url, entry.retry, entry.status]);
    const serviceActions = React.useMemo(() => discovery ? [
        signedIn ? {
            id: 'account-service-status',
            testID: 'connection-popover-account-service-status',
            label: serviceName,
            subtitle: t('settingsAccount.accountServiceSignedInTo', { accountService: serviceName }),
        } : null,
        {
            id: 'account-find-homes',
            testID: 'connection-popover-find-homes',
            label: t('settingsAccount.accountServiceFindHomes'),
            subtitle: t('settingsAccount.accountServiceFindHomesDescription'),
            onPress: () => openEntry({ kind: 'enter', target: { kind: 'automatic' } }),
        },
        currentHomeServerIdentityId && (!signedIn || directorySnapshot?.status !== 'ready' || !currentHomeIsLinked) ? {
            id: 'account-link-current-home',
            testID: 'connection-popover-link-current-home',
            label: t('settingsAccount.accountServiceLinkThisHome'),
            subtitle: t('settingsAccount.accountServiceLinkThisHomeDescription', {
                accountService: discovery.accountServiceDisplayName ?? undefined,
            }),
            onPress: () => openEntry({ kind: 'link', homeServerIdentityId: currentHomeServerIdentityId }),
        } : null,
        signedIn ? {
            id: 'account-service-sign-out',
            testID: 'connection-popover-account-service-sign-out',
            label: t('settingsAccount.logoutHome', { home: serviceName }),
            subtitle: t('settingsAccount.tapToDisconnect'),
            onPress: signOut,
        } : null,
    ] : [], [currentHomeIsLinked, currentHomeServerIdentityId, directorySnapshot?.status, discovery, openEntry, serviceName, signOut, signedIn]);
    const homeActions = React.useMemo(() => signedIn ? directorySnapshot?.homes.map((home) => ({
        id: `account-directory-home-${home.homeServerIdentityId}`,
        testID: `connection-popover-account-directory-home-${home.homeServerIdentityId}`,
        label: home.label,
        subtitle: home.canonicalServerUrl,
    })) ?? [] : [], [directorySnapshot?.homes, signedIn]);

    return (
        <>
            <ActionListSection actions={serviceNotice ? [serviceNotice, ...serviceActions] : serviceActions} />
            <ActionListSection title={t('settingsAccount.accountServiceHomes')} actions={homeActions} />
        </>
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
    const connectionHealth = useActiveHomeConnectionHealth();
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
    const displayHomeCarrier = displayUsesActiveSnapshot ? getActiveServerHomeCarrier() : null;
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
        fireAndForget(setClipboardStringSafe(sanitizeDoctorDiagnosticText(report)).then((copied) => {
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
    const handleActivate = React.useCallback(() => {
        if (props.variant === 'header') {
            const result = runGuardedNavigation(() => router.push('/server'));
            if (result !== true) {
                fireAndForget(result, { tag: 'ConnectionStatusControl.nav.fullScreenHomes' });
            }
            return;
        }
        setOpen((currentOpen) => {
            if (currentOpen) {
                setDetailsExpanded(false);
                setDiagnosticsCopied(false);
            }
            return !currentOpen;
        });
    }, [props.variant, router]);
    const popoverMinWidth = props.variant === 'sidebar' && Platform.OS === 'web' ? POPOVER_MIN_WIDTH : undefined;
    const collapsedStatusLabel = t(homeSummary.statusLabelKey);
    const collapsedStatusColor = homeSummaryPresentation.color;
    // DESIGN.md forbids color as the only carrier of meaning. For states that
    // truly need attention (canonical health tone), the collapsed trigger swaps
    // its bare dot for a warning glyph carrying the same status color — one
    // quiet non-color cue. Routine connected/connecting stays dot-only and
    // transport-neutral; detail remains inside the popover.
    const collapsedShowsAttentionCue =
        homeSummary.statusKey === 'action_required' || homeSummary.statusKey === 'error';
    const collapsedStatusIsPulsing = homeSummary.statusKey === 'connecting';
    const socketPresentation = resolveStatusPresentation(
        theme,
        resolveSocketStatusKey(socketStatus.status),
    );
    const machineStatusKey = resolveMachineStatusKey(connectionHealth.kind);
    const machinesPresentation = resolveStatusPresentation(theme, machineStatusKey);

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
                    style={[
                        styles.statusContainer,
                        props.variant === 'header'
                            ? styles.headerStatusContainer
                            : styles.sidebarStatusContainer,
                    ]}
                    onPress={handleActivate}
                    accessibilityRole="button"
                    accessibilityLabel={`${activeServerLabel}, ${collapsedStatusLabel}`}
                    accessibilityState={props.variant === 'sidebar' ? { expanded: open } : undefined}
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
                            isPulsing={collapsedStatusIsPulsing}
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
                        name={props.variant === 'header' ? 'caret-right' : open ? 'caret-up' : 'caret-down'}
                        size={chevronSize}
                        color={collapsedStatusColor}
                        style={styles.statusChevron}
                    />
                </Pressable>
                {props.variant === 'sidebar' && open ? (
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
                                    <ConnectionPopoverStatusRow
                                        testID="connection-popover-realtime"
                                        icon="pulse"
                                        title={t('systemStatus.ui.realtime')}
                                        subtitle={t('systemStatus.ui.socket')}
                                        statusLabel={t(socketPresentation.labelKey)}
                                        statusColor={socketPresentation.color}
                                        dotColor={socketPresentation.dotColor}
                                        statusVariant={socketPresentation.pillVariant}
                                        divided
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
                                        divided
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

                                <ConnectionPopoverAccountEntryActions
                                    profile={displayServerProfile}
                                    runtimeOrigin={displayUsesActiveSnapshot && !displayHomeCarrier ? activeServerSnapshot.runtimeOrigin ?? null : null}
                                    homeCarrier={displayHomeCarrier}
                                    onClose={() => {
                                        setOpen(false);
                                        setDetailsExpanded(false);
                                    }}
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
                                        transportState: transportDiagnostics?.state,
                                    });
                                    const endpointPresentation = resolveStatusPresentation(theme, relayStatusKey);
                                    const canRetryRelayConnection =
                                        relayStatusKey === 'connecting'
                                        || relayStatusKey === 'disconnected'
                                        || relayStatusKey === 'error';
                                    if (!transportDiagnostics && !(displayUsesActiveSnapshot && activeServerSnapshot.carrier === 'iroh')) {
                                        return null;
                                    }
                                    return (
                                        <View style={styles.popoverStatusList}>
                                            <ConnectionPopoverStatusRow
                                                testID="connection-popover-relay"
                                                icon="hard-drives"
                                                title={t('systemStatus.transport.irohCurrent')}
                                                subtitle={toServerUrlDisplay(displayServerUrl)}
                                                statusLabel={t(endpointPresentation.labelKey)}
                                                statusColor={endpointPresentation.color}
                                                dotColor={endpointPresentation.dotColor}
                                                statusVariant={endpointPresentation.pillVariant}
                                                onRetry={canRetryRelayConnection ? handleRetry : undefined}
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
