import React from 'react';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { SafeIonicons } from '@/components/ui/icons/SafeIonicons';
import { Switch } from '@/components/ui/forms/Switch';
import type { Profile } from '@/sync/domains/profiles/profile';
import { getLinkedProvider } from '@/sync/domains/profiles/profile';
import { useHappyAction } from '@/hooks/ui/useHappyAction';
import { Modal } from '@/modal';
import { t } from '@/text';
import { sync } from '@/sync/sync';
import { HappyError } from '@/utils/errors/errors';
import { setAccountIdentityShowOnProfile } from '@/sync/api/account/apiIdentity';
import { storage } from '@/sync/domains/state/storageStore';
import { TokenStorage, type AuthCredentials } from '@/auth/storage/tokenStorage';
import { authProviderRegistry, getAuthProvider, normalizeProviderId } from '@/auth/providers/registry';
import { fetchHomeAuthEntry } from '@/auth/entry/authEntryClient';
import { projectAuthEntryMethodCapabilities } from '@/auth/capabilities/authMethodCapabilities';
import { useOAuthProviderConfigured } from '@/hooks/server/useOAuthProviderConfigured';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { isSafeExternalAuthUrl } from '@/auth/providers/externalAuthUrl';
import { Icon } from '@/components/ui/icons/Icon';
import { teamAuthenticationPath } from '@/components/settings/teams/teamsRoutes';
import { useServerFeaturesRuntimeSnapshot } from '@/sync/domains/features/featureDecisionRuntime';
import { identityAdministrationFailureMessage } from '@/components/settings/identity/identityAdministrationFailure';

type ProviderIdentityItemsProps = Readonly<{
    profile: Profile;
    credentials: AuthCredentials | null;
    applyProfile: (profile: Profile) => void;
    returnTo: string;
}>;

type ProviderDescriptor = Readonly<{
    id: string;
    displayName: string;
    iconHint?: string | null;
    canConnect: boolean;
}>;

type ManagedTeamAddress = Readonly<{
    serverId: string;
    teamId: string;
}>;

type ProviderCatalogState =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'legacy' }>
    | Readonly<{ kind: 'current'; descriptors: readonly ProviderDescriptor[] }>
    | Readonly<{ kind: 'unavailable' }>;

function mapIdentityErrorToMessage(error: unknown, providerDisplayName: string): string {
    if (!(error instanceof HappyError)) return t('errors.operationFailed');
    const code = error.code ?? error.message;
    switch (code) {
        case 'username-taken':
            return t('friends.username.taken');
        case 'invalid-username':
            return t('friends.username.invalid');
        case 'username-disabled':
            return t('friends.username.disabled');
        case 'friends-disabled':
            return t('friends.disabled');
        case 'provider-already-linked':
            return t('errors.providerAlreadyLinked', { provider: providerDisplayName });
        default:
            return identityAdministrationFailureMessage(code);
    }
}

async function openProviderConnectUrl(params: {
    url: string;
}): Promise<boolean> {
    if (!isSafeExternalAuthUrl(params.url)) {
        await TokenStorage.clearPendingExternalConnect();
        await Modal.alert(t('common.error'), t('errors.operationFailed'));
        return false;
    }

    const supported = await Linking.canOpenURL(params.url);
    if (!supported) {
        await TokenStorage.clearPendingExternalConnect();
        await Modal.alert(t('common.error'), t('errors.operationFailed'));
        return false;
    }

    try {
        await Linking.openURL(params.url);
        return true;
    } catch {
        await TokenStorage.clearPendingExternalConnect();
        await Modal.alert(t('common.error'), t('errors.operationFailed'));
        return false;
    }
}

/**
 * Whether this Home can host a managed identity at all.
 *
 * A Home that predates managed integrations answers "no management metadata"
 * correctly, and its members keep the disconnect and profile-publication
 * controls that Home has always enforced server-side. Only a Home that could
 * have sent management metadata and did not is unclassified, and there the
 * destructive and publication controls fail closed rather than guessing
 * "personal".
 */
function releasedIdentityControlsApply(catalog: ProviderCatalogState): boolean {
    return catalog.kind === 'legacy';
}

function ProviderIdentityItem(props: Readonly<{
    provider: (typeof authProviderRegistry)[number];
    management: NonNullable<Profile['linkedIdentityManagementV1']>[number] | null;
    /** The Home cannot host managed identities, so its released controls stand. */
    releasedControls: boolean;
    /** Undefined means the released feature-capability fallback owns availability. */
    connectAvailable?: boolean | null;
    profile: Profile;
    credentials: AuthCredentials | null;
    applyProfile: (profile: Profile) => void;
    returnTo: string;
    managedTeamAddress?: ManagedTeamAddress;
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const providerId = normalizeProviderId(props.provider.id);
    const providerDisplayName = props.provider.displayName ?? props.provider.id;
    const identity = providerId ? getLinkedProvider(props.profile, providerId) : null;
    const oauthSupported = useOAuthProviderConfigured(providerId ?? '__none__');
    const connectAvailable = props.connectAvailable === undefined
        ? oauthSupported
        : props.connectAvailable;
    const canDisconnect = props.management?.canDisconnect ?? props.releasedControls;
    const canPublishProfile = props.management?.canPublishProfile ?? props.releasedControls;
    const openManagedTeam = React.useCallback(() => {
        if (!props.managedTeamAddress) return;
        router.push(teamAuthenticationPath(props.managedTeamAddress));
    }, [props.managedTeamAddress, router]);
    const [savingShowOnProfile, setSavingShowOnProfile] = React.useState(false);

    const [disconnecting, disconnect] = useHappyAction(async () => {
        if (!canDisconnect) return;
        if (!props.credentials) return;
        const confirmed = await Modal.confirm(
            t('modals.disconnectService', { service: providerDisplayName }),
            t('modals.disconnectServiceConfirm', { service: providerDisplayName }),
            { confirmText: t('modals.disconnect'), destructive: true },
        );
        if (!confirmed) return;
        await props.provider.disconnect(props.credentials);
        await sync.refreshProfile();
    });

    const [connecting, connect] = useHappyAction(async () => {
        if (connectAvailable !== true) return;
        if (!props.credentials || !providerId) return;

        try {
            await TokenStorage.setPendingExternalConnect({ provider: providerId, returnTo: props.returnTo });
            const url = await props.provider.getConnectUrl(props.credentials);
            await openProviderConnectUrl({ url });
        } catch (error) {
            await TokenStorage.clearPendingExternalConnect();
            await Modal.alert(t('common.error'), mapIdentityErrorToMessage(error, providerDisplayName));
        }
    });

    const onToggleShowOnProfile = async (value: boolean) => {
        if (
            !canPublishProfile
            || !props.credentials
            || !identity
            || savingShowOnProfile
        ) return;

        setSavingShowOnProfile(true);
        try {
            await setAccountIdentityShowOnProfile({
                credentials: props.credentials,
                providerId: identity.id,
                showOnProfile: value,
            });

            const currentProfile = storage.getState().profile;
            props.applyProfile({
                ...currentProfile,
                linkedProviders: (currentProfile.linkedProviders ?? []).map((linkedProvider) =>
                    normalizeProviderId(linkedProvider.id) === normalizeProviderId(identity.id)
                        ? { ...linkedProvider, showOnProfile: value }
                        : linkedProvider,
                ),
            });
        } catch (error) {
            await Modal.alert(t('common.error'), mapIdentityErrorToMessage(error, providerDisplayName));
        } finally {
            setSavingShowOnProfile(false);
        }
    };

    const iconName = props.provider.badgeIconName ?? 'key-outline';
    const iconColor = theme.colors.text.secondary;
    const icon =
        identity?.avatarUrl ? (
            <Image
                source={{ uri: identity.avatarUrl }}
                style={{ width: 29, height: 29, borderRadius: 14.5 }}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
            />
        ) : (
            <Icon name={iconName as any} size={29} color={iconColor} />
        );

    if (!identity) {
        return (
            <Item
                title={providerDisplayName}
                subtitle={
                    connectAvailable === false
                        ? t('friends.providerGate.notConfigured', { provider: providerDisplayName })
                        : t('friends.providerGate.title', { provider: providerDisplayName })
                }
                onPress={connectAvailable === true ? connect : undefined}
                disabled={connectAvailable !== true || connecting}
                loading={connecting || connectAvailable == null}
                showChevron={false}
                icon={icon}
            />
        );
    }

    return (
        <>
            <Item
                title={providerDisplayName}
                detail={identity.login ? `@${identity.login}` : identity.displayName ?? undefined}
                subtitle={canDisconnect
                    ? t('settingsAccount.tapToDisconnect')
                    : props.management?.managedBy?.kind === 'team'
                        ? t('teams.groups.managedBy', { source: props.management.managedBy.team.name })
                        : props.management?.managedBy?.kind === 'home'
                            ? t('teams.groups.managedBy', { source: t('identityAdministration.providerOwnerHome') })
                            : props.management?.requiredByTeams.length
                                ? t('teams.groups.managedBy', {
                                    source: props.management.requiredByTeams.map((team) => team.name).join(', '),
                                })
                                : undefined}
                onPress={canDisconnect ? disconnect : props.managedTeamAddress ? openManagedTeam : undefined}
                loading={disconnecting}
                showChevron={!canDisconnect && props.managedTeamAddress !== undefined}
                icon={icon}
            />
            {canPublishProfile ? (
                <Item
                    title={t('settingsAccount.showProviderOnProfile', { provider: providerDisplayName })}
                    rightElement={(
                        <Switch
                            value={identity.showOnProfile}
                            onValueChange={(value) => {
                                void onToggleShowOnProfile(value);
                            }}
                            disabled={savingShowOnProfile}
                        />
                    )}
                    showChevron={false}
                />
            ) : null}
        </>
    );
}

export const ProviderIdentityItems = React.memo((props: ProviderIdentityItemsProps) => {
    const activeServer = useActiveServerSnapshot();
    const featuresSnapshot = useServerFeaturesRuntimeSnapshot();
    const [catalog, setCatalog] = React.useState<ProviderCatalogState>({ kind: 'loading' });
    const catalogTargetRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        const abortController = new AbortController();
        const targetKey = `${activeServer.serverId}\u0000${activeServer.serverUrl}`;
        if (catalogTargetRef.current !== targetKey) {
            catalogTargetRef.current = targetKey;
            setCatalog({ kind: 'loading' });
        }
        void fetchHomeAuthEntry({ signal: abortController.signal })
            .then((result) => {
                if (abortController.signal.aborted) return;
                if (result.kind === 'unsupported') {
                    setCatalog({ kind: 'legacy' });
                    return;
                }
                if (result.kind !== 'ready' || result.projection.state !== 'ready') {
                    setCatalog({ kind: 'unavailable' });
                    return;
                }

                const capabilities = projectAuthEntryMethodCapabilities(result.projection);
                const descriptors = new Map<string, ProviderDescriptor>();
                for (const method of capabilities.catalog.methods) {
                    const id = normalizeProviderId(method.id);
                    if (!id || id === 'key_challenge' || id === 'email_password' || id === 'mtls') continue;
                    descriptors.set(id, {
                        id,
                        displayName: method.presentation?.displayName ?? id,
                        ...(method.presentation?.iconHint !== undefined
                            ? { iconHint: method.presentation.iconHint }
                            : {}),
                        canConnect: method.enabledActions.some((action) => action.id === 'connect'),
                    });
                }
                setCatalog({ kind: 'current', descriptors: [...descriptors.values()] });
            })
            .catch(() => {
                if (!abortController.signal.aborted) setCatalog({ kind: 'unavailable' });
            });
        return () => abortController.abort();
    }, [activeServer.generation, activeServer.serverId, activeServer.serverUrl]);

    const rows = React.useMemo(() => {
        const byId = new Map<string, Readonly<{
            provider: (typeof authProviderRegistry)[number];
            connectAvailable?: boolean | null;
            management: NonNullable<Profile['linkedIdentityManagementV1']>[number] | null;
        }>>();
        if (catalog.kind === 'legacy' || catalog.kind === 'loading') {
            for (const provider of authProviderRegistry) {
                const id = normalizeProviderId(provider.id);
                if (!id) continue;
                byId.set(id, {
                    provider,
                    management: null,
                    ...(catalog.kind === 'loading' ? { connectAvailable: null } : {}),
                });
            }
            if (catalog.kind === 'legacy' && featuresSnapshot.status === 'ready') {
                for (const [rawId, descriptor] of Object.entries(featuresSnapshot.features.capabilities.auth.providers)) {
                    const id = normalizeProviderId(rawId);
                    if (!id || !descriptor.enabled || !descriptor.configured) continue;
                    const provider = getAuthProvider(id, {
                        displayName: descriptor.ui?.displayName ?? rawId,
                        ...(descriptor.ui?.iconHint ? { badgeIconName: descriptor.ui.iconHint } : {}),
                    });
                    if (!provider) continue;
                    byId.set(id, {
                        provider,
                        connectAvailable: true,
                        management: null,
                    });
                }
            }
        } else if (catalog.kind === 'current') {
            for (const descriptor of catalog.descriptors) {
                if (!descriptor.canConnect && !getLinkedProvider(props.profile, descriptor.id)) continue;
                const provider = getAuthProvider(descriptor.id, {
                    displayName: descriptor.displayName,
                    ...(descriptor.iconHint ? { badgeIconName: descriptor.iconHint } : {}),
                });
                if (provider) byId.set(descriptor.id, {
                    provider,
                    connectAvailable: descriptor.canConnect,
                    management: null,
                });
            }
        }

        const managementByProviderId = new Map(
            (props.profile.linkedIdentityManagementV1 ?? []).map((management) => [
                normalizeProviderId(management.providerId),
                management,
            ]),
        );
        for (const identity of props.profile.linkedProviders ?? []) {
            const id = normalizeProviderId(identity.id);
            if (!id) continue;
            const management = managementByProviderId.get(id) ?? null;
            const existing = byId.get(id);
            const provider = (management
                ? getAuthProvider(id, {
                    displayName: management.descriptor.displayName ?? id,
                    ...(management.descriptor.iconHint
                        ? { badgeIconName: management.descriptor.iconHint }
                        : {}),
                })
                : getAuthProvider(id)) ?? existing?.provider;
            if (provider) byId.set(id, {
                provider,
                connectAvailable: existing?.connectAvailable ?? false,
                management,
            });
        }
        return [...byId.values()];
    }, [catalog, featuresSnapshot, props.profile]);

    const releasedControls = releasedIdentityControlsApply(catalog);

    return (
        <>
            {rows.map(({ provider, connectAvailable, management }) => (
                <ProviderIdentityItem
                    key={provider.id}
                    provider={provider}
                    management={management}
                    releasedControls={releasedControls}
                    {...(connectAvailable !== undefined ? { connectAvailable } : {})}
                    profile={props.profile}
                    credentials={props.credentials}
                    applyProfile={props.applyProfile}
                    returnTo={props.returnTo}
                    {...(management?.managedBy?.kind === 'team'
                        ? { managedTeamAddress: { serverId: activeServer.serverId, teamId: management.managedBy.team.id } }
                        : {})}
                />
            ))}
        </>
    );
});
