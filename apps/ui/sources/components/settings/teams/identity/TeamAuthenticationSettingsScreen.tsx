import * as React from 'react';
import { useRouter } from 'expo-router';
import type {
    TeamIdentityConnectionStateV1,
    TeamIdentityEligibleProviderV1,
} from '@happier-dev/protocol/teams';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { identityAdministrationFailureMessage } from '@/components/settings/identity/identityAdministrationFailure';
import { projectAuthenticationMethodCapabilities } from '@/auth/capabilities/authMethodCapabilities';
import { useServerFeaturesSnapshotForServerId } from '@/sync/domains/features/featureDecisionRuntime';
import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { t } from '@/text';

import { TeamSection } from '../TeamSection';
import type { TeamSectionContext } from '../teamSectionContext';
import { teamDirectoryPath, teamIdentityConnectionPath, teamIdentityProviderSetupPath } from '../teamsRoutes';
import { TeamAuthenticationPolicySections } from './TeamAuthenticationPolicySections';
import { TeamMemberSignInLinkSection } from './TeamMemberSignInLinkSection';
import { TeamGitHubAppsSection } from './TeamGitHubAppScreens';
import { identityConnectionMode } from './identityAdministrationPresentation';
import { useIdentityAdministration } from './useIdentityAdministration';
import { createIdentityAdministrationClient } from './identityAdministrationClient';

function providerKindLabel(kind: 'oidc' | 'workos_sso' | 'github_app_identity'): string {
    if (kind === 'oidc') return 'OpenID Connect';
    if (kind === 'workos_sso') return 'WorkOS';
    return 'GitHub';
}

export function connectionStateLabel(state: TeamIdentityConnectionStateV1): string {
    switch (state) {
        case 'unavailable': return t('teams.authentication.status.unavailable');
        case 'prohibited': return t('teams.authentication.status.prohibited');
        case 'not_configured': return t('teams.authentication.status.notConfigured');
        case 'setting_up': return t('teams.authentication.status.settingUp');
        case 'connected': return t('teams.authentication.status.connected');
        case 'needs_attention': return t('teams.authentication.status.needsAttention');
        case 'disabled': return t('teams.authentication.status.disabled');
    }
}

/** Consume the catalog's exact Team-owned GitHub creation decision. */
function githubAppCreationAvailable(eligibleProviders: readonly TeamIdentityEligibleProviderV1[]): boolean {
    return eligibleProviders.some((provider) => provider.providerKind === 'github_app_identity'
        && provider.availability.status === 'available'
        && provider.availability.setupChoice.kind === 'create_managed');
}

const AuthorizedAuthenticationContent = React.memo(function AuthorizedAuthenticationContent(props: Readonly<{
    context: TeamSectionContext;
    scope: Parameters<typeof useIdentityAdministration>[0];
    address: Parameters<typeof teamIdentityConnectionPath>[0];
}>) {
    const router = useRouter();
    const { state, refresh } = useIdentityAdministration(props.scope, props.address.teamId);
    const client = React.useMemo(
        () => createIdentityAdministrationClient(props.scope, {
            onApprovalPending: props.context.requestApproval,
        }),
        [props.context.requestApproval, props.scope.accountId, props.scope.serverId],
    );
    const [pendingProviderId, setPendingProviderId] = React.useState<string | null>(null);
    const [providerFailure, setProviderFailure] = React.useState<string | null>(null);

    // The Home's own sign-in methods, read from the capability projection the
    // Home already publishes to every client that opens its sign-in page. A Team
    // administrator therefore learns nothing about Home configuration that a
    // visitor could not already see, and no second Home-method owner is created:
    // this is the same canonical projector the Welcome and Team entry surfaces
    // consume. Only methods that can *log in* can be an accepted reference.
    const homeFeatures = useServerFeaturesSnapshotForServerId(props.scope.serverId);
    const homeMethods = React.useMemo(() => (
        homeFeatures.status === 'ready'
            ? projectAuthenticationMethodCapabilities(homeFeatures.features).catalog.methods
                .filter((method) => method.enabledActions.some((action) => action.id === 'login'))
                .map((method) => Object.freeze({
                    methodId: method.id,
                    displayName: method.presentation?.displayName ?? method.id,
                }))
            : []
    ), [homeFeatures]);

    // A typed Home outcome becomes one localized sentence, announced as well as
    // shown because it lands away from the control that was pressed.
    const reportProviderFailure = React.useCallback((code: string) => {
        const message = identityAdministrationFailureMessage(code);
        setProviderFailure(message);
        announceAccessibilityMessage(message);
    }, []);

    const finishConnectionCreation = React.useCallback((connectionId: string) => {
        refresh();
        router.push(teamIdentityConnectionPath(props.address, connectionId));
    }, [props.address, refresh, router]);

    // Admission and accepted sign-in are Team *policy*, not connection data.
    // A list that has not answered must still show the current policy, while
    // admission edits wait for the server-owned applicability projection.
    if (state.kind === 'loading') {
        return (
            <>
                <ItemGroup title={t('teams.authentication.connectionsSection')}>
                    <Item
                        testID="team-authentication-loading"
                        title={t('common.loading')}
                        leftElement={<ActivitySpinner />}
                        showChevron={false}
                    />
                </ItemGroup>
                <TeamAuthenticationPolicySections
                    context={props.context}
                    connections={[]}
                    connectionsCurrent={false}
                    admissionModeApplicability={null}
                    homeMethods={homeMethods}
                    homeMethodsCurrent={homeFeatures.status === 'ready'}
                />
            </>
        );
    }

    if (state.kind === 'unavailable') {
        return (
            <>
                <ItemGroup title={t('teams.authentication.connectionsSection')}>
                    <Item
                        testID="team-authentication-unavailable"
                        title={t('teams.unavailable.title')}
                        subtitle={state.failure.retryable
                            ? identityAdministrationFailureMessage(state.failure.code)
                            : t('teams.errors.forbidden')}
                        detail={state.failure.retryable ? t('common.retry') : undefined}
                        onPress={state.failure.retryable ? refresh : undefined}
                        showChevron={false}
                    />
                </ItemGroup>
                <TeamAuthenticationPolicySections
                    context={props.context}
                    connections={[]}
                    connectionsCurrent={false}
                    admissionModeApplicability={null}
                    homeMethods={homeMethods}
                    homeMethodsCurrent={homeFeatures.status === 'ready'}
                />
            </>
        );
    }

    const modeLabel = (connection: (typeof state.items)[number]) => (
        identityConnectionMode(connection) === 'sign_in_time_groups'
            ? t('teams.authentication.mode.signInTimeGroups')
            : t('teams.authentication.mode.signInOnly')
    );
    const projectionCurrent = !state.refreshing && !state.stale;

    const useExistingProvider = async (provider: (typeof state.eligibleProviders)[number]) => {
        if (!props.context.canMutate || !projectionCurrent) return;
        if (provider.availability.status !== 'available' || provider.availability.setupChoice.kind !== 'use_existing') return;
        const choice = provider.availability.setupChoice;
        setPendingProviderId(choice.providerInstanceId); setProviderFailure(null);
        try {
            const result = await client.execute('teams.identity.connections.create', {
                v: 1, teamId: props.address.teamId,
                providerInstanceId: choice.providerInstanceId,
                externalReference: choice.connectionDraft.externalReference,
                settings: choice.connectionDraft.settings,
            }, {
                onApprovalSucceeded: (value) => finishConnectionCreation(value.connection.id),
                onApprovalFailed: reportProviderFailure,
            });
            if (!result.ok) {
                if ('approvalPending' in result) return;
                reportProviderFailure(result.failure.code);
                return;
            }
            finishConnectionCreation(result.value.connection.id);
        } catch {
            // Transport failures must settle visibly; otherwise the action's
            // pending state clears while the rejection becomes an unhandled
            // promise and the row gives no recovery path.
            reportProviderFailure('operation_failed');
        } finally { setPendingProviderId(null); }
    };

    const createManagedProvider = async (provider: (typeof state.eligibleProviders)[number]) => {
        if (!props.context.canMutate || !projectionCurrent) return;
        if (provider.availability.status !== 'available' || provider.availability.setupChoice.kind !== 'create_managed') return;
        const actionId = provider.availability.setupChoice.actionId;
        if (actionId === 'teams.identity.workos.connection.create') {
            setPendingProviderId(provider.providerKind); setProviderFailure(null);
            try {
                const result = await client.execute(actionId, { v: 1, teamId: props.address.teamId }, {
                    onApprovalSucceeded: (value) => finishConnectionCreation(value.connection.id),
                    onApprovalFailed: reportProviderFailure,
                });
                if (!result.ok) {
                    if ('approvalPending' in result) return;
                    reportProviderFailure(result.failure.code);
                    return;
                }
                finishConnectionCreation(result.value.connection.id);
            } catch {
                reportProviderFailure('operation_failed');
            } finally { setPendingProviderId(null); }
            return;
        }
        router.push(teamIdentityProviderSetupPath(props.address, provider.providerKind === 'oidc' ? 'oidc' : 'github_app_identity'));
    };

    return (
        <>
            {state.stale ? (
                <ItemGroup footer={t('teams.stale.label')}>
                    <Item
                        testID="team-authentication-stale"
                        title={t('teams.unavailable.offline')}
                        detail={t('common.retry')}
                        onPress={refresh}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
            <ItemGroup
                title={t('teams.authentication.connectionsSection')}
                footer={t('teams.authentication.subtitle')}
            >
                {state.items.length === 0 ? (
                    <Item
                        testID="team-authentication-empty"
                        title={t('teams.authentication.empty')}
                        showChevron={false}
                    />
                ) : state.items.map((connection) => (
                    <Item
                        key={connection.id}
                        testID={`team-authentication-connection-${connection.id}`}
                        title={connection.provider.displayName}
                        subtitle={modeLabel(connection)}
                        detail={connectionStateLabel(connection.state)}
                        onPress={() => router.push(teamIdentityConnectionPath(props.address, connection.id))}
                    />
                ))}
            </ItemGroup>
            <ItemGroup title={t('identityAdministration.eligibleProviders')}>
                {state.eligibleProviders.map((provider, index) => {
                    const choice = provider.availability.status === 'available' ? provider.availability.setupChoice : null;
                    const title = provider.displayName ?? providerKindLabel(provider.providerKind);
                    const owner = provider.owner === 'home'
                        ? t('identityAdministration.providerOwnerHome')
                        : t('identityAdministration.providerOwnerTeam');
                    return <Item
                        key={provider.providerId ?? `${provider.providerKind}:${provider.owner}:${index}`}
                        testID={`team-eligible-provider:${provider.providerId ?? provider.providerKind}`}
                        title={title}
                        subtitle={owner}
                        detail={provider.availability.status === 'unavailable'
                            ? t('identityAdministration.providerUnavailable')
                            : choice?.kind === 'use_existing'
                                ? t('identityAdministration.providerUseExisting')
                                : choice?.kind === 'contact_home_admin'
                                    ? t('identityAdministration.providerContactAdmin')
                                    : t('identityAdministration.providerSetup')}
                        loading={(choice?.kind === 'use_existing' && pendingProviderId === choice.providerInstanceId)
                            || (choice?.kind === 'create_managed' && pendingProviderId === provider.providerKind)}
                        disabled={!projectionCurrent || !props.context.canMutate || pendingProviderId !== null || provider.availability.status === 'unavailable' || choice?.kind === 'contact_home_admin'}
                        onPress={choice?.kind === 'use_existing'
                            ? () => void useExistingProvider(provider)
                            : choice?.kind === 'create_managed'
                                ? () => void createManagedProvider(provider)
                                : undefined}
                        showChevron={choice?.kind === 'create_managed' && choice.actionId !== 'teams.identity.workos.connection.create'}
                    />;
                })}
            </ItemGroup>
            {providerFailure ? <ItemGroup><Item testID="team-authentication-failure" title={providerFailure} showChevron={false} /></ItemGroup> : null}
            {/* Admission and accepted sign-in are Team policy, written through the
                one revision-guarded `teams.policy.set` owner rather than through
                the connection client above. */}
            <TeamAuthenticationPolicySections
                context={props.context}
                connections={state.items}
                connectionsCurrent={projectionCurrent}
                admissionModeApplicability={state.admissionModeApplicability}
                homeMethods={homeMethods}
                homeMethodsCurrent={homeFeatures.status === 'ready'}
            />
            {/* Existing registrations remain inspectable when policy later
                disables new setup; only the create affordance is unavailable. */}
            <TeamGitHubAppsSection
                context={props.context}
                createAvailable={githubAppCreationAvailable(state.eligibleProviders)}
            />
            {/* The page members are sent to. It carries no bearer, so it is
                shown to any administrator who can read this screen. */}
            <TeamMemberSignInLinkSection
                address={props.address}
                memberSignInUrl={state.memberSignInUrl}
            />
            <ItemGroup
                title={t('teams.authentication.directory.section')}
                footer={t('teams.authentication.directory.overviewSubtitle')}
            >
                <Item
                    testID="team-authentication-directory"
                    title={t('teams.authentication.directory.title')}
                    subtitle={t('teams.authentication.directory.manageSubtitle')}
                    onPress={() => router.push(teamDirectoryPath(props.address))}
                />
            </ItemGroup>
        </>
    );
});

export const TeamAuthenticationSettingsScreen = React.memo(function TeamAuthenticationSettingsScreen(props: Readonly<{
    serverId: string;
    teamId: string;
}>) {
    return (
        <TeamSection serverId={props.serverId} teamId={props.teamId} title={t('teams.tabs.authentication')}>
            {(context) => context.team.capabilities.manageAuthentication ? (
                <AuthorizedAuthenticationContent context={context} scope={context.scope} address={context.address} />
            ) : (
                <ItemGroup title={t('teams.tabs.authentication')}>
                    <Item
                        testID="team-authentication-forbidden"
                        title={t('homeGovernance.forbiddenTitle')}
                        subtitle={t('teams.errors.forbidden')}
                        showChevron={false}
                    />
                </ItemGroup>
            )}
        </TeamSection>
    );
});
