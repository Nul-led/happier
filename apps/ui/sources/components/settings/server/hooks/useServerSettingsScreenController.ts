import * as React from 'react';
import { Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Modal } from '@/modal';
import { t } from '@/text';
import type { SystemTaskRunState } from '@/components/systemTasks/types';
import { validateServerUrl } from '@/sync/domains/server/serverConfig';
import {
    getActiveServerId,
    getActiveServerSnapshot,
    getDeviceDefaultServerId,
    getResetToDefaultServerId,
    getServerProfileById,
    listServerProfiles,
    resolveServerProfileScopeId,
    type ServerProfile,
    removeServerProfile,
    adoptHomeProfile,
} from '@/sync/domains/server/serverProfiles';
import { setActiveServerAndSwitch } from '@/sync/domains/server/activeServerSwitch';
import {
    filterServerSelectionGroupsToAvailableServers,
    normalizeStoredServerSelectionGroups,
} from '@/sync/domains/server/selection/serverSelectionMutations';
import { normalizeServerSelectionGroupsForSettings } from '@/sync/domains/server/selection/serverSelectionSettingsAdapter';
import {
    listServerProfileScopeIds,
    normalizeServerSelectionSettingsForProfileScopeIds,
} from '@/sync/domains/server/selection/serverSelectionProfileScopeIds';
import { buildServerSelectionActiveTargetForServer } from '@/sync/domains/server/selection/serverSelectionActiveTarget';
import { resolveActiveServerSelectionFromRawSettings } from '@/sync/domains/server/selection/serverSelectionResolution';
import type { ServerSelectionGroup } from '@/sync/domains/server/selection/serverSelectionTypes';
import { canonicalizeServerUrl } from '@/sync/domains/server/url/serverUrlCanonical';
import { isInsecureRemoteHttpServerUrl } from '@/sync/domains/server/url/serverUrlClassification';
import { useAuth } from '@/auth/context/AuthContext';
import { useMachineListStatusByServerId, useSettings, useSocketStatus } from '@/sync/domains/state/storage';
import { useHomeViewSelectionSettingsMutable } from '@/hooks/server/useHomeViewSelectionSettings';
import { parseServerSettingsRouteParams } from '@/components/settings/server/navigation/serverSettingsRouteParams';
import { useServerAuthStatusByServerId } from '@/components/settings/server/hooks/useServerAuthStatusByServerId';
import { useServerAutoAddFromRoute } from '@/components/settings/server/hooks/useServerAutoAddFromRoute';
import { useEndpointReachabilityRemediationController } from '@/components/settings/server/hooks/useEndpointReachabilityRemediationController';
import { useServerSettingsServerProfileActions } from '@/components/settings/server/hooks/useServerSettingsServerProfileActions';
import { useServerSettingsGroupActions } from '@/components/settings/server/hooks/useServerSettingsGroupActions';
import { useServerSettingsConcurrentActions } from '@/components/settings/server/hooks/useServerSettingsConcurrentActions';
import { useRelayDriftBanner } from '@/components/settings/server/useRelayDriftBanner';
import type { RelayDriftBanner } from '@/components/settings/server/relayDriftTypes';
import {
    resolveEndpointReachabilityRemediation,
    type EndpointReachabilityRemediation,
    type EndpointReachabilityRemediationAction,
} from '@/components/serverReachability/remediation';
import { getServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import { readServerReachabilityProbeTimeoutMs } from '@/sync/runtime/connectivity/serverReachabilityTuning';
import { createEndpointReadinessProbe } from '@/sync/runtime/connectivity/createEndpointReadinessProbe';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';

type SearchParams = Readonly<{ url?: string | string[]; auto?: string | string[]; source?: string | string[] }>;
type SwitchServerByIdOptions = Readonly<{
    normalizeRoute?: boolean;
    preserveSelectionTarget?: boolean;
    scope?: 'device' | 'tab';
}>;

function normalizeUrl(raw: string): string {
    return canonicalizeServerUrl(raw);
}

function defaultServerName(rawUrl: string): string {
    const url = normalizeUrl(rawUrl);
    try {
        const parsed = new URL(url);
        const host = parsed.hostname;
        if (!host) return url;
        return parsed.port ? `${host}:${parsed.port}` : host;
    } catch {
        return url;
    }
}

function shouldWarnAboutInsecureHttpServerUrl(rawUrl: string): boolean {
    const normalized = normalizeUrl(rawUrl);
    if (!normalized) return false;
    return isInsecureRemoteHttpServerUrl(normalized);
}

export type ServerSettingsController = Readonly<{
    screenOptions: Readonly<{ headerShown: true; headerTitle: string; headerBackTitle: string }>;

    servers: ReadonlyArray<ServerProfile>;
    serverGroups: ReadonlyArray<ServerSelectionGroup>;
    activeServerId: string;
    activeServerUrl: string;
    activeLocalRelayUrl: string | null;
    deviceDefaultServerId: string;
    activeTargetKey: string | null;
    authStatusByServerId: Readonly<Record<string, 'signedIn' | 'signedOut' | 'unknown'>>;
    connectionStatusByServerId?: Readonly<Record<string, 'connected' | 'connecting' | 'disconnected' | 'error' | 'unknown'>>;
    relayDriftBanner: RelayDriftBanner | null;

    autoMode: boolean;
    inputUrl: string;
    inputName: string;
    error: string | null;
    isValidating: boolean;
    reachabilityRemediation: EndpointReachabilityRemediation | null;
    reachabilityRemediationTaskSnapshot: SystemTaskRunState | null;
    addServerPrefillHint: string | null;
    addServerDefaultExpanded: 'server' | 'group' | null;
    onChangeUrl: (value: string) => void;
    onChangeName: (value: string) => void;
    onResetServer: () => Promise<void>;
    onAddServer: () => Promise<void>;
    onReachabilityRemediationAction: (actionId: EndpointReachabilityRemediationAction['id']) => Promise<void>;

    onSwitchServer: (profile: ServerProfile, scope?: 'device' | 'tab') => Promise<void>;
    onSwitchGroup: (profile: ServerSelectionGroup) => Promise<void>;
    onRenameServer: (profile: ServerProfile) => Promise<void>;
    onRemoveServer: (profile: ServerProfile) => Promise<void>;
    onRenameGroup: (profile: ServerSelectionGroup) => Promise<void>;
    onRemoveGroup: (profile: ServerSelectionGroup) => Promise<void>;
    onCreateServerGroup: (params: { name: string; serverIds: string[] }) => Promise<boolean>;

    groupSelectionEnabled: boolean;
    setGroupSelectionEnabled: (value: boolean) => void;
    groupSelectionPresentation: 'grouped' | 'flat-with-badge';
    activeServerGroupId: string | null;
    selectedGroupServerIds: ReadonlySet<string>;
    onToggleGroupPresentation: () => void;
    onToggleGroupServer: (serverId: string) => void;
}>;

export function useServerSettingsScreenController(): ServerSettingsController {
    const router = useRouter();
    const auth = useAuth();
    const relayDriftBanner = useRelayDriftBanner();
    const searchParams = useLocalSearchParams<SearchParams>();

    const [revision, setRevision] = React.useState(0);
    const [inputUrl, setInputUrl] = React.useState('');
    const [inputName, setInputName] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);
    const [isValidating, setIsValidating] = React.useState(false);
    const [reachabilityRemediation, setReachabilityRemediation] = React.useState<EndpointReachabilityRemediation | null>(null);
    const validationAttemptIdRef = React.useRef(0);
    const validationAbortControllerRef = React.useRef<AbortController | null>(null);
    const inputUrlRef = React.useRef(inputUrl);

    const accountSettings = useSettings();
    const {
        serverSelectionGroups,
        serverSelectionActiveTargetKind,
        serverSelectionActiveTargetId,
        setHomeViewSelectionSettings,
    } = useHomeViewSelectionSettingsMutable(accountSettings);
    const serverProfilesGeneration = useServerProfilesGeneration();
    const subscribedActiveServer = useActiveServerSnapshot();

    React.useEffect(() => {
        inputUrlRef.current = inputUrl;
    }, [inputUrl]);

    const route = React.useMemo(() => {
        return parseServerSettingsRouteParams({ url: searchParams.url, auto: searchParams.auto, source: searchParams.source });
    }, [searchParams.auto, searchParams.source, searchParams.url]);
    const autoMode = route.auto;
    const addServerPrefillHint = route.source === 'notification' && route.url ? t('server.notificationAddServerHint') : null;
    const addServerDefaultExpanded = route.source === 'notification' && route.url ? ('server' as const) : null;

    const switchServerById = React.useCallback(async (serverId: string, opts?: SwitchServerByIdOptions) => {
        const targetProfile = getServerProfileById(serverId);
        const targetServerId = targetProfile ? resolveServerProfileScopeId(targetProfile) : serverId;
        const switched = await setActiveServerAndSwitch({
            serverId: targetServerId,
            scope: opts?.scope ?? 'device',
            refreshAuth: auth.refreshFromActiveServer,
        });
        if (switched === 'blocked') return switched;
        if (opts?.preserveSelectionTarget !== true) {
            const target = buildServerSelectionActiveTargetForServer(targetServerId);
            setHomeViewSelectionSettings((current) => ({ ...current, ...target }));
        }
        if (opts?.normalizeRoute ?? true) {
            router.replace('/server');
        }
        return switched;
    }, [auth, router, setHomeViewSelectionSettings]);

    const validateServerReachable = React.useCallback(async (url: string): Promise<boolean> => {
        const attemptId = (validationAttemptIdRef.current += 1);
        validationAbortControllerRef.current?.abort();
        const controller = new AbortController();
        validationAbortControllerRef.current = controller;
        try {
            setIsValidating(true);
            setError(null);
            setReachabilityRemediation(null);

            const normalized = normalizeUrl(url);
            if (!normalized) {
                setError(t('errors.invalidFormat'));
                return false;
            }

            const timeoutMs = readServerReachabilityProbeTimeoutMs();
            const probe = createEndpointReadinessProbe({
                endpoint: normalized,
                token: null,
                timeoutMs,
                signal: controller.signal,
            });
            const result = await probe();

            if (attemptId !== validationAttemptIdRef.current) {
                return false;
            }

            if (result.status === 'ready') return true;

            setReachabilityRemediation(resolveEndpointReachabilityRemediation({
                endpointUrl: normalized,
                readiness: result,
                platformOs: Platform.OS,
                isDesktopShell: isDesktopHost(),
            }));

            const message = typeof result.errorMessage === 'string' ? result.errorMessage : '';
            if (message.includes('returned')) {
                setError(t('server.serverReturnedError'));
            } else {
                setError(t('server.failedToConnectToServer'));
            }
            return false;
        } catch {
            if (attemptId === validationAttemptIdRef.current) {
                const normalized = normalizeUrl(url);
                if (normalized) {
                    setReachabilityRemediation(resolveEndpointReachabilityRemediation({
                        endpointUrl: normalized,
                        readiness: {
                            status: 'server_unreachable',
                            errorMessage: 'Network request failed',
                        },
                        platformOs: Platform.OS,
                        isDesktopShell: isDesktopHost(),
                    }));
                }
                setError(t('server.failedToConnectToServer'));
            }
            return false;
        } finally {
            if (attemptId === validationAttemptIdRef.current) {
                setIsValidating(false);
            }
        }
    }, []);

    const {
        error: reachabilityRemediationError,
        taskSnapshot: reachabilityRemediationTaskSnapshot,
        onAction: onReachabilityRemediationAction,
    } = useEndpointReachabilityRemediationController({
        remediation: reachabilityRemediation,
        endpoint: inputUrlRef.current ? normalizeUrl(inputUrlRef.current) : null,
        onRetryEndpoint: async (endpoint) => {
            setReachabilityRemediation(null);
            await validateServerReachable(endpoint);
        },
    });
    const isPreparingTailscale = reachabilityRemediationTaskSnapshot != null && reachabilityRemediationTaskSnapshot.result == null;

    React.useEffect(() => {
        if (!reachabilityRemediationError) {
            return;
        }
        setError(reachabilityRemediationError);
    }, [reachabilityRemediationError]);

    useServerAutoAddFromRoute({
        enabled: autoMode,
        url: route.url,
        validateServerReachable,
        setError,
        onSwitchServerById: async (serverId, opts) => {
            await switchServerById(serverId, opts);
        },
        onAfterSuccess: () => {
            setRevision((r) => r + 1);
            router.replace('/');
        },
        source: 'url',
    });

    React.useEffect(() => {
        if (!route.url) return;
        if (autoMode || !inputUrl.trim()) {
            if (inputUrl.trim() !== route.url) setInputUrl(route.url);
            if (error) setError(null);
        }
    }, [autoMode, error, inputUrl, route.url]);

    const servers = React.useMemo(() => {
        try {
            return listServerProfiles()
                .slice();
        } catch {
            return [] as ServerProfile[];
        }
    }, [revision, serverProfilesGeneration]);

    const validServerIds = React.useMemo(() => new Set(listServerProfileScopeIds(servers)), [servers]);

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

    const storedGroupProfiles = React.useMemo(
        () => normalizeStoredServerSelectionGroups(serverSelectionScopeSettings.serverSelectionGroups),
        [serverSelectionScopeSettings.serverSelectionGroups],
    );
    const normalizedGroupProfiles = React.useMemo(() => filterServerSelectionGroupsToAvailableServers(storedGroupProfiles, validServerIds), [storedGroupProfiles, validServerIds]);

    const activeServerIdValue = React.useMemo(() => {
        try {
            return getActiveServerId();
        } catch {
            return getResetToDefaultServerId();
        }
    }, [revision, serverProfilesGeneration]);

    const deviceDefaultServerId = React.useMemo(() => {
        try {
            return getDeviceDefaultServerId();
        } catch {
            return getResetToDefaultServerId();
        }
    }, [revision, subscribedActiveServer]);

    const resolvedActiveSelection = React.useMemo(() => resolveActiveServerSelectionFromRawSettings({
        activeServerId: activeServerIdValue,
        availableServerIds: listServerProfileScopeIds(servers),
        settings: serverSelectionScopeSettings,
    }), [
        activeServerIdValue,
        serverSelectionScopeSettings,
        servers,
    ]);

    const activeTargetKey = React.useMemo(() => {
        const target = resolvedActiveSelection.activeTarget;
        return target.id ? `${target.kind}:${target.id}` : null;
    }, [resolvedActiveSelection.activeTarget]);

    const authStatusByServerId = useServerAuthStatusByServerId(servers);
    const socketStatus = useSocketStatus();
    const machineListStatusByServerId = useMachineListStatusByServerId();
    const connectionStatusByServerId = React.useMemo(() => {
        const result: Record<string, 'connected' | 'connecting' | 'disconnected' | 'error' | 'unknown'> = {};
        for (const profile of servers) {
            const id = resolveServerProfileScopeId(profile);
            const status = machineListStatusByServerId[id] ?? machineListStatusByServerId[profile.id];
            result[id] = id === activeServerIdValue || profile.id === activeServerIdValue
                ? socketStatus.status
                : status === 'idle' ? 'connected' : status === 'loading' ? 'connecting' : status === 'error' ? 'disconnected' : 'unknown';
        }
        return result;
    }, [activeServerIdValue, machineListStatusByServerId, servers, socketStatus.status]);
    const activeServerUrl = React.useMemo(() => {
        return servers.find((profile) => profile.id === activeServerIdValue || resolveServerProfileScopeId(profile) === activeServerIdValue)?.serverUrl ?? '';
    }, [activeServerIdValue, servers]);
    const activeServerSnapshot = React.useMemo(() => {
        try {
            return getActiveServerSnapshot();
        } catch {
            return {
                serverId: activeServerIdValue,
                serverUrl: activeServerUrl,
                activeLocalRelayUrl: null,
                generation: 0,
            };
        }
    }, [activeServerIdValue, activeServerUrl]);
    const activeLocalRelayUrl = React.useMemo(() => {
        const value = typeof activeServerSnapshot.activeLocalRelayUrl === 'string'
            ? activeServerSnapshot.activeLocalRelayUrl.trim()
            : '';
        return value.length > 0 ? value : null;
    }, [activeServerSnapshot.activeLocalRelayUrl]);

    React.useEffect(() => {
        const normalizedStored = normalizeStoredServerSelectionGroups(serverSelectionScopeSettings.serverSelectionGroups);
        const rawComparable = Array.isArray(serverSelectionGroups) ? serverSelectionGroups : [];
        if (JSON.stringify(normalizedStored) !== JSON.stringify(rawComparable)) {
            setHomeViewSelectionSettings((current) => ({
                ...current,
                serverSelectionGroups: normalizeServerSelectionGroupsForSettings(normalizedStored),
            }));
            return;
        }
        const kind = serverSelectionActiveTargetKind === 'server' || serverSelectionActiveTargetKind === 'group'
            ? serverSelectionActiveTargetKind
            : null;
        const id = String(serverSelectionActiveTargetId ?? '').trim();
        if (kind === 'group' && id && !normalizedStored.some((profile) => profile.id === id)) {
            setHomeViewSelectionSettings((current) => ({
                ...current,
                serverSelectionActiveTargetKind: activeServerIdValue ? 'server' : null,
                serverSelectionActiveTargetId: activeServerIdValue || null,
            }));
        }
    }, [
        activeServerIdValue,
        serverSelectionActiveTargetId,
        serverSelectionActiveTargetKind,
        serverSelectionGroups,
        serverSelectionScopeSettings.serverSelectionGroups,
        setHomeViewSelectionSettings,
    ]);

    const activeMultiServerProfileId = React.useMemo(() => {
        const target = resolvedActiveSelection.activeTarget;
        return target.kind === 'group' && target.id ? target.id : null;
    }, [resolvedActiveSelection.activeTarget]);

    const activeGroupProfile = React.useMemo(() => (
        activeMultiServerProfileId
            ? normalizedGroupProfiles.find((profile) => profile.id === activeMultiServerProfileId) ?? null
            : null
    ), [activeMultiServerProfileId, normalizedGroupProfiles]);

    const selectedConcurrentServerIds = React.useMemo(() => {
        if (activeGroupProfile) return new Set(activeGroupProfile.serverIds);
        return new Set(resolvedActiveSelection.allowedServerIds);
    }, [activeGroupProfile, resolvedActiveSelection.allowedServerIds]);

    const concurrentActions = useServerSettingsConcurrentActions({
        activeGroupId: activeMultiServerProfileId,
        serverSelectionGroupsRaw: serverSelectionGroups,
        setServerSelectionGroups: (value) => setHomeViewSelectionSettings((current) => ({
            ...current,
            serverSelectionGroups: normalizeServerSelectionGroupsForSettings(value),
        })),
    });

    const profileActions = useServerSettingsServerProfileActions({
        authStatusByServerId,
        onSwitchServerById: async (serverId, scope) => {
            return await switchServerById(serverId, { scope });
        },
        onAfterSignedOutSwitch: () => router.replace('/'),
        setRevision,
    });

    const groupActions = useServerSettingsGroupActions({
        servers,
        activeServerId: activeServerIdValue,
        validServerIds,
        authStatusByServerId,
        normalizedGroupProfiles,
        activeGroupId: activeMultiServerProfileId,
        groupPresentation: (activeGroupProfile?.presentation ?? 'grouped') === 'flat-with-badge' ? 'flat-with-badge' : 'grouped',
        setRevision,
        onSwitchServerById: async (serverId) => {
            return await switchServerById(serverId, {
                preserveSelectionTarget: true,
            });
        },
        onAfterSignedOutSwitch: () => router.replace('/'),
        setHomeViewSelectionSettings,
    });

    const onAddServer = React.useCallback(async () => {
        if (!inputUrl.trim()) {
            Modal.alert(t('common.error'), t('server.enterServerUrl'));
            return;
        }

        const validation = validateServerUrl(inputUrl);
        if (!validation.valid) {
            setError(validation.error || t('errors.invalidFormat'));
            return;
        }

        if (shouldWarnAboutInsecureHttpServerUrl(inputUrl)) {
            const shouldContinue = await Modal.confirm(
                t('server.insecureHttpUrlTitle'),
                t('server.insecureHttpUrlBody'),
                { confirmText: t('common.ok'), cancelText: t('common.cancel') },
            );
            if (!shouldContinue) return;
        }

        const isValid = await validateServerReachable(inputUrl);
        if (!isValid) return;

        const normalized = normalizeUrl(inputUrl);
        const name = inputName.trim() ? inputName.trim() : defaultServerName(normalized);
        const preexistingProfileIds = new Set(
            listServerProfiles().map((profile) => profile.id),
        );
        const created = await adoptHomeProfile({
            descriptor: {
                serverUrl: normalized,
                displayName: name,
            },
            source: 'manual',
            preserveUserLabel: true,
        });
        const createdForThisAttempt =
            !preexistingProfileIds.has(created.id);

        let profile = created;
        try {
            const featuresSnapshot = await getServerFeaturesSnapshot({ serverId: created.id, force: true, timeoutMs: 1000 });
            if (featuresSnapshot.status === 'ready') {
                const advertisedRaw = featuresSnapshot.features.capabilities?.server?.canonicalServerUrl;
                const advertised = typeof advertisedRaw === 'string' ? normalizeUrl(advertisedRaw) : '';
                const learnedIdentity = featuresSnapshot.features.capabilities?.serverIdentity?.serverIdentityId
                    ?? getServerProfileById(created.id)?.serverIdentityId
                    ?? undefined;
                if (advertised && (advertised !== created.serverUrl || learnedIdentity)) {
                    const confirm = advertised === created.serverUrl
                        ? true
                        : await Modal.confirm(
                            t('server.useCanonicalServerUrlTitle'),
                            t('server.useCanonicalServerUrlBody'),
                            { confirmText: t('common.use'), cancelText: t('common.keep') },
                        );
                    if (confirm) {
                        const canonical = await adoptHomeProfile({
                            descriptor: {
                                serverUrl: created.serverUrl,
                                canonicalServerUrl: advertised,
                                displayName: created.name,
                                ...(learnedIdentity ? { homeServerIdentityId: learnedIdentity } : {}),
                            },
                            source: 'manual',
                            preserveUserLabel: true,
                        });
                        if (
                            createdForThisAttempt
                            && canonical.id !== created.id
                        ) {
                            try {
                                removeServerProfile(created.id);
                            } catch {
                                // ignore; best-effort cleanup
                            }
                        }
                        profile = canonical;
                    }
                }
            }
            profile = getServerProfileById(profile.id) ?? profile;
        } catch {
            // best-effort
        }

        setRevision((r) => r + 1);
    }, [inputName, inputUrl, validateServerReachable]);

    const onResetServer = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            t('server.resetToDefault'),
            t('server.resetServerDefault'),
            { confirmText: t('common.reset'), destructive: true }
        );

        if (confirmed) {
            await switchServerById(getResetToDefaultServerId());
            setInputUrl('');
            setInputName('');
            setRevision((r) => r + 1);
        }
    }, [switchServerById]);

    const screenOptions = React.useMemo(() => ({
        headerShown: true as const,
        headerTitle: t('server.serverConfiguration'),
        headerBackTitle: t('common.back'),
    }), []);

    return {
        screenOptions,

        servers,
        serverGroups: normalizedGroupProfiles,
        activeServerId: activeServerIdValue,
        activeServerUrl,
        activeLocalRelayUrl,
        deviceDefaultServerId,
        activeTargetKey,
        authStatusByServerId,
        connectionStatusByServerId,
        relayDriftBanner,

        autoMode,
        inputUrl,
        inputName,
        error,
        isValidating: isValidating || isPreparingTailscale,
        reachabilityRemediation,
        reachabilityRemediationTaskSnapshot,
        addServerPrefillHint,
        addServerDefaultExpanded,
        onChangeUrl: (value) => {
            setInputUrl(value);
            setError(null);
            setReachabilityRemediation(null);
        },
        onChangeName: setInputName,
        onResetServer,
        onAddServer,
        onReachabilityRemediationAction,

        onSwitchServer: profileActions.onSwitchServer,
        onSwitchGroup: groupActions.onSwitchGroup,
        onRenameServer: profileActions.onRenameServer,
        onRemoveServer: profileActions.onRemoveServer,
        onRenameGroup: groupActions.onRenameGroup,
        onRemoveGroup: groupActions.onRemoveGroup,
        onCreateServerGroup: groupActions.onCreateServerGroup,

        groupSelectionEnabled: activeMultiServerProfileId !== null,
        setGroupSelectionEnabled: (value) => {
            if (!value) {
                setHomeViewSelectionSettings((current) => ({
                    ...current,
                    serverSelectionActiveTargetKind: activeServerIdValue ? 'server' : null,
                    serverSelectionActiveTargetId: activeServerIdValue || null,
                }));
                return;
            }
            const nextGroupId = (() => {
                if (activeMultiServerProfileId) return activeMultiServerProfileId;
                if (activeServerIdValue) {
                    const candidates = normalizedGroupProfiles.filter((profile) => profile.serverIds.includes(activeServerIdValue));
                    if (candidates.length > 0) {
                        const multiServerCandidates = candidates.filter((profile) => profile.serverIds.length > 1);
                        const pool = multiServerCandidates.length > 0 ? multiServerCandidates : candidates;
                        let best = pool[0]!;
                        for (const candidate of pool.slice(1)) {
                            if (candidate.serverIds.length > best.serverIds.length) {
                                best = candidate;
                            }
                        }
                        return best.id;
                    }
                }
                return normalizedGroupProfiles[0]?.id ?? null;
            })();
            if (!nextGroupId) return;
            setHomeViewSelectionSettings((current) => ({
                ...current,
                serverSelectionActiveTargetKind: 'group',
                serverSelectionActiveTargetId: nextGroupId,
            }));
        },
        groupSelectionPresentation: (activeGroupProfile?.presentation ?? 'grouped') === 'flat-with-badge' ? 'flat-with-badge' : 'grouped',
        activeServerGroupId: activeMultiServerProfileId,
        selectedGroupServerIds: selectedConcurrentServerIds,
        onToggleGroupPresentation: concurrentActions.onTogglePresentation,
        onToggleGroupServer: concurrentActions.onToggleConcurrentServer,
    };
}
