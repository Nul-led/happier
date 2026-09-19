import * as React from 'react';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Modal } from '@/modal';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import {
    deleteTeamCredentialResource,
    listTeamCredentialDirectMaterialPreparation,
    testTeamCredentialResource,
    updateTeamCredentialResource,
} from '@/sync/ops/teams/teamCredentialOperations';
import { t } from '@/text';

import { TeamSection } from '../TeamSection';
import type { TeamSectionContext } from '../teamSectionContext';
import {
    teamCredentialAccessPath,
    teamCredentialActivityPath,
    teamCredentialEditPath,
    teamCredentialExternalApiPath,
    teamCredentialLimitsPath,
    teamCredentialRequestPolicyPath,
    teamCredentialUsagePath,
    teamCredentialsPath,
} from '../teamsRoutes';
import {
    audienceSummary,
    brokerPlacementLabel,
    credentialApprovalFailureMessage,
    credentialFailureMessage,
    deliveryModeLabel,
    recipientDeliveryMode,
    requestPolicySummary,
    resourceDeliverySummary,
    resourceState,
    resourceStateLabel,
    sessionUsePolicyLabel,
    sourceKindLabel,
} from './teamCredentialPresentation';
import { useAppUpdateStatus } from '@/updates/useAppUpdateStatus';
import {
    recoveryDestinationIsNavigable,
    teamCredentialRecoveryLabel,
    teamCredentialRecoveryPresentation,
    type TeamCredentialRecoveryPresentation,
} from './teamCredentialPresentation';
import { useTeamCredentialResourceView } from './useTeamCredentialResourceView';
import { useTeamCredentialExternalApiAvailability } from './useTeamCredentialExternalApiAvailability';

function directMaterialStateLabel(state: NonNullable<ReturnType<typeof useTeamCredentialResourceView>['catalogResource']>['directMaterialState']): string {
    switch (state) {
        case 'current': return t('teams.credentials.directReadiness.state.ready');
        case 'preparing': return t('teams.credentials.directReadiness.state.preparing');
        case 'never_delivered': return t('teams.credentials.directReadiness.state.notDelivered');
        case 'stale': return t('teams.credentials.directReadiness.state.sourceChanged');
        case 'revoked': return t('teams.credentials.detail.notFound');
    }
}

/**
 * The one recovery row the Home's recovery action maps to.
 *
 * Every destination already exists — reload, the resource's own Settings where
 * the source and broker placement live, the app-update owner — and the handoff
 * and choose-another arms are instructions rather than navigations. Whoever
 * reaches this row was allowed here by the Home; the mapper only says what the
 * typed recovery action means, never who may perform it.
 */
const CredentialRecoveryRow = React.memo(function CredentialRecoveryRow(props: Readonly<{
    recovery: TeamCredentialRecoveryPresentation;
    retryTestID: string;
    onRetry: () => void;
    onOpenResourceSettings: () => void;
    onAppUpdate: () => void;
    onChooseAnotherResource: () => void;
}>) {
    const { theme } = useUnistyles();
    const navigable = recoveryDestinationIsNavigable(props.recovery.destination);
    const label = teamCredentialRecoveryLabel(props.recovery);
    const isRetry = props.recovery.destination === 'retry';
    return (
        <ItemGroup>
            <Item
                testID={isRetry ? props.retryTestID : 'team-credential-recovery'}
                title={label}
                icon={<Icon
                    name={props.recovery.destination === 'app_update'
                        ? 'download'
                        : props.recovery.destination === 'source_owner_handoff'
                            || props.recovery.destination === 'choose_another_resource'
                            ? 'warning'
                            : 'arrow-clockwise'}
                    size={29}
                    color={theme.colors.text.secondary}
                />}
                disabled={!navigable}
                onPress={() => {
                    if (!navigable) return;
                    if (isRetry) props.onRetry();
                    else if (props.recovery.destination === 'app_update') props.onAppUpdate();
                    else if (props.recovery.destination === 'choose_another_resource') props.onChooseAnotherResource();
                    else props.onOpenResourceSettings();
                }}
                showChevron={false}
            />
        </ItemGroup>
    );
});

/**
 * One shared credential.
 *
 * The overview is Settings-native: a header that says what the resource is and
 * whether it is usable, then grouped rows that open the focused destinations.
 * There is no second navigation system inside it, and opening it loads neither
 * activity nor anything else a person did not ask for.
 */
const CredentialDetail = React.memo(function CredentialDetail(props: Readonly<{
    context: TeamSectionContext;
    resourceId: string;
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { context, resourceId } = props;
    const view = useTeamCredentialResourceView({ context, resourceId });
    const appUpdate = useAppUpdateStatus();
    const externalApiAvailability = useTeamCredentialExternalApiAvailability(context.scope.serverId);
    const [mutating, setMutating] = React.useState(false);
    // An unresolved approval already carries this screen's last write, so every
    // control it owns stays visible and disabled rather than disappearing.
    const busy = mutating || view.writesSuspended;
    const [notice, setNotice] = React.useState<string | null>(null);
    const [preparationPending, setPreparationPending] = React.useState<number | null>(null);
    const [preparationBusy, setPreparationBusy] = React.useState(false);
    const [testBusy, setTestBusy] = React.useState(false);
    const [testResult, setTestResult] = React.useState<string | null>(null);
    const targetKey = `${context.scope.serverId}:${context.scope.accountId}:${context.address.teamId}:${resourceId}`;
    const currentTargetKey = React.useRef(targetKey);
    currentTargetKey.current = targetKey;

    React.useEffect(() => {
        setMutating(false);
        setNotice(null);
        setPreparationPending(null);
        setPreparationBusy(false);
        setTestBusy(false);
        setTestResult(null);
    }, [targetKey]);

    if (!view.featureEnabled) {
        return (
            <ItemGroup footer={t('teams.credentials.unavailable')}>
                <Item
                    testID="team-credential-unavailable"
                    title={t('teams.credentials.title')}
                    showChevron={false}
                />
            </ItemGroup>
        );
    }

    if (view.resource === null && view.catalogResource !== null) {
        const resource = view.catalogResource;
        // A least-privilege catalog row carries no custodian identity, so a
        // recipient is never treated as the person who can repair the source;
        // the Home's handoff instruction is rendered as is.
        const recipientRecovery = teamCredentialRecoveryPresentation(resource.recoveryAction, {
            isSourceCustodian: false,
        });
        return (
            <>
                <ItemGroup title={resource.displayName} footer={`${context.team.name} · ${context.homeName}`}>
                    <Item
                        testID="team-credential-recipient-source"
                        title={t('teams.credentials.detail.sourceLabel')}
                        detail={sourceKindLabel(resource.sourcePresentation)}
                        showChevron={false}
                    />
                    <Item
                        testID="team-credential-recipient-state"
                        title={resourceStateLabel(resource.readiness.kind)}
                        detail={(() => {
                            const mode = recipientDeliveryMode(resource);
                            return mode ? deliveryModeLabel(mode) : undefined;
                        })()}
                        icon={resource.readiness.kind === 'available' ? undefined : (
                            <Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />
                        )}
                        showChevron={false}
                    />
                    {resource.sessionUsePolicy ? (
                        <Item
                            testID="team-credential-recipient-use-policy"
                            title={t('teams.credentials.usePolicy.label')}
                            detail={sessionUsePolicyLabel(resource.sessionUsePolicy)}
                            showChevron={false}
                        />
                    ) : null}
                    {resource.mayReceiveDirect ? (
                        <Item
                            testID="team-credential-recipient-direct-readiness"
                            title={t('teams.credentials.directReadiness.title')}
                            detail={directMaterialStateLabel(resource.directMaterialState)}
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>
                <ItemGroup>
                    <Item
                        testID="team-credential-recipient-open-usage"
                        title={t('teams.credentials.detail.usage')}
                        onPress={() => router.push(teamCredentialUsagePath(context.address, resourceId))}
                    />
                </ItemGroup>
                {recipientRecovery === null ? null : (
                    <CredentialRecoveryRow
                        recovery={recipientRecovery}
                        retryTestID="team-credential-recipient-retry"
                        onRetry={() => void view.reload()}
                        onOpenResourceSettings={() => router.push(teamCredentialEditPath(context.address, resourceId))}
                        onAppUpdate={() => void appUpdate.runPrimaryAction()}
                        onChooseAnotherResource={() => router.push(teamCredentialsPath(context.address))}
                    />
                )}
            </>
        );
    }

    if (view.resource === null) {
        // Until the Home has answered, absence proves nothing; afterwards it is
        // the answer, and the retry belongs to whichever of the two it is.
        return view.resolved ? (
            <ItemGroup footer={t('teams.credentials.detail.notFound')}>
                <Item
                    testID="team-credential-not-found"
                    title={t('teams.errors.notFound')}
                    showChevron={false}
                />
            </ItemGroup>
        ) : view.error ? (
            <ItemGroup footer={t('teams.unavailable.offline')}>
                <Item
                    testID="team-credential-retry"
                    title={t('teams.unavailable.retry')}
                    icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />}
                    onPress={() => void view.reload()}
                    showChevron={false}
                />
            </ItemGroup>
        ) : (
            <ItemGroup>
                <Item
                    testID="team-credential-loading"
                    title={t('teams.credentials.title')}
                    loading
                    showChevron={false}
                />
            </ItemGroup>
        );
    }

    const { resource } = view;
    // The Home discloses the audience, and admits the administrative history,
    // only to the viewer who administers resources. A member's empty grant lists
    // therefore mean "not shown" and must not be read as state, and the two
    // destinations that would be refused are not offered.
    const { capabilities } = resource;
    const state = resourceState(resource);
    const delivery = capabilities.manageAudience ? resourceDeliverySummary(resource) : null;
    const custodian = resource.custodianAccountId === context.scope.accountId
        ? t('teams.credentials.sharedByYou')
        : null;
    const brokerConnectionSemantics = resource.brokerPlacement?.kind === 'machine_pool'
        ? t('machinePools.connectionSemantics')
        : undefined;
    // The Home's typed recovery for this exact resource. Only its source
    // custodian can repair the source or move the broker, so anyone else —
    // including a Team manager — is handed to the owner rather than being
    // offered a Settings destination that would refuse them.
    const administratorRecovery = teamCredentialRecoveryPresentation(resource.recoveryAction, {
        isSourceCustodian: capabilities.updateBrokerPlacement
            || capabilities.narrowDisclosure
            || capabilities.refreshDirectMaterial,
    });

    return (
        <>
            <ItemGroup title={resource.displayName} footer={notice ?? custodian ?? undefined}>
                <Item
                    testID="team-credential-source"
                    title={t('teams.credentials.detail.sourceLabel')}
                    detail={sourceKindLabel(resource.source ?? resource.sourcePresentation)}
                    showChevron={false}
                />
                <Item
                    testID="team-credential-state"
                    title={resourceStateLabel(state)}
                    subtitle={delivery ?? undefined}
                    // State is never colour alone: the label carries it, and the
                    // icon only repeats what the text already says.
                    icon={state === 'available' ? undefined : (
                        <Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />
                    )}
                    showChevron={false}
                />
                {capabilities.managePolicy ? <Item
                    testID="team-credential-use-policy"
                    title={t('teams.credentials.usePolicy.label')}
                    detail={sessionUsePolicyLabel(resource.sessionUsePolicy)}
                    subtitle={resource.sessionUsePolicy === 'team_visibility_required'
                        ? t('teams.credentials.usePolicy.visibilityNote')
                        : undefined}
                    showChevron={false}
                /> : null}
                <Item
                    testID="team-credential-test"
                    title={t('settingsProviders.detail.testConnection')}
                    detail={testResult ?? undefined}
                    loading={testBusy}
                    // Test registers its own approval, so it shares this
                    // screen's approval custody: starting a second unresolved
                    // Action would orphan the decision already waiting.
                    disabled={testBusy || busy}
                    showChevron={false}
                    onPress={async () => {
                        if (testBusy || busy) return;
                        const requestedTargetKey = targetKey;
                        setTestBusy(true);
                        setTestResult(null);
                        try {
                            const outcome = await testTeamCredentialResource({
                                scope: context.scope,
                                teamId: context.address.teamId,
                                resourceId,
                                handlers: {
                                    // Test is the one intent whose whole value
                                    // is its answer. A deferred approval must
                                    // still deliver that readiness, not a bare
                                    // "it ran".
                                    onApprovalSucceeded: (result) => {
                                        if (currentTargetKey.current !== requestedTargetKey) return;
                                        setTestResult(result.recovery ?? resourceStateLabel(result.readiness.kind));
                                    },
                                    onApprovalFailed: (code) => {
                                        if (currentTargetKey.current !== requestedTargetKey) return;
                                        setTestResult(credentialApprovalFailureMessage(code));
                                    },
                                },
                            });
                            if (currentTargetKey.current !== requestedTargetKey) return;
                            if (outcome.kind === 'succeeded') {
                                setTestResult(outcome.value.recovery
                                    ?? resourceStateLabel(outcome.value.readiness.kind));
                            } else {
                                setTestResult(credentialFailureMessage(outcome.failure));
                            }
                        } catch (cause) {
                            if (currentTargetKey.current !== requestedTargetKey) return;
                            if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.registration);
                            else setTestResult(t('teams.errors.generic'));
                        } finally {
                            if (currentTargetKey.current === requestedTargetKey) setTestBusy(false);
                        }
                    }}
                />
                {resource.source !== null ? <Item
                    testID="team-credential-broker"
                    title={t('teams.credentials.detail.brokerLabel')}
                    // The stored placement is the Home's own opaque Machine id,
                    // and it names a machine belonging to the source custodian
                    // rather than to the reader. Printing it would put a raw
                    // internal identifier on a settings screen without making
                    // anyone able to act on it.
                    detail={brokerPlacementLabel(resource)}
                    subtitle={brokerConnectionSemantics}
                    accessibilityLabel={[t('teams.credentials.detail.brokerLabel'), brokerPlacementLabel(resource), brokerConnectionSemantics]
                        .filter(Boolean).join('. ')}
                    showChevron={false}
                /> : null}
            </ItemGroup>

            {administratorRecovery !== null ? (
                <CredentialRecoveryRow
                    recovery={administratorRecovery}
                    retryTestID="team-credential-admin-retry"
                    onRetry={() => void view.reload()}
                    onOpenResourceSettings={() => router.push(teamCredentialEditPath(context.address, resourceId))}
                    onAppUpdate={() => void appUpdate.runPrimaryAction()}
                    onChooseAnotherResource={() => router.push(teamCredentialsPath(context.address))}
                />
            ) : null}

            {capabilities.refreshDirectMaterial ? (
                <ItemGroup footer={t('teams.credentials.directReadiness.automatic')}>
                    <Item
                        testID="team-credential-preparation-refresh"
                        title={t('teams.credentials.directReadiness.check')}
                        detail={preparationPending === null
                            ? undefined
                            : preparationPending === 0
                                ? t('teams.credentials.directReadiness.allReady')
                                : t('session.access.preparationPending', { count: preparationPending })}
                        loading={preparationBusy}
                        // The census registers its own approval too, so it
                        // shares the same unresolved-approval custody as Test.
                        disabled={preparationBusy || busy}
                        showChevron={false}
                        onPress={async () => {
                            if (preparationBusy || busy) return;
                            const requestedTargetKey = targetKey;
                            setPreparationBusy(true);
                            setNotice(null);
                            try {
                                let cursor: string | null = null;
                                let pending = 0;
                                do {
                                    const outcome = await listTeamCredentialDirectMaterialPreparation({
                                        scope: context.scope,
                                        teamId: context.address.teamId,
                                        resourceId,
                                        ...(cursor ? { cursor } : {}),
                                    });
                                    if (currentTargetKey.current !== requestedTargetKey) return;
                                    if (outcome.kind === 'failed') {
                                        setNotice(credentialFailureMessage(outcome.failure));
                                        return;
                                    }
                                    pending += outcome.value.recipients.filter((recipient) => recipient.readiness !== 'ready').length;
                                    cursor = outcome.value.nextCursor;
                                } while (cursor !== null);
                                setPreparationPending(pending);
                            } catch (cause) {
                                if (currentTargetKey.current !== requestedTargetKey) return;
                                if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.registration);
                                else setNotice(t('teams.errors.generic'));
                            } finally {
                                if (currentTargetKey.current === requestedTargetKey) setPreparationBusy(false);
                            }
                        }}
                    />
                </ItemGroup>
            ) : null}

            <ItemGroup>
                {capabilities.manageAudience ? (
                    <Item
                        testID="team-credential-open-access"
                        title={t('teams.credentials.detail.access')}
                        detail={audienceSummary(resource)}
                        onPress={() => router.push(teamCredentialAccessPath(context.address, resourceId))}
                    />
                ) : null}
                {capabilities.managePolicy ? (
                    <Item
                        testID="team-credential-open-request-policy"
                        title={t('teams.credentials.requestPolicy.title')}
                        detail={requestPolicySummary(resource)}
                        onPress={() => router.push(teamCredentialRequestPolicyPath(context.address, resourceId))}
                    />
                ) : null}
                {capabilities.manageAudience || capabilities.managePolicy || capabilities.manageLimits ? (
                    <Item
                        testID="team-credential-open-activity"
                        title={t('teams.credentials.detail.activity')}
                        onPress={() => router.push(teamCredentialActivityPath(context.address, resourceId))}
                    />
                ) : null}
                {capabilities.manageLimits ? (
                    <Item
                        testID="team-credential-open-limits"
                        title={t('teams.credentials.detail.limits')}
                        onPress={() => router.push(teamCredentialLimitsPath(context.address, resourceId))}
                    />
                ) : null}
                <Item
                    testID="team-credential-open-usage"
                    title={t('teams.credentials.detail.usage')}
                    onPress={() => router.push(teamCredentialUsagePath(context.address, resourceId))}
                />
                {capabilities.managePolicy && (
                    externalApiAvailability.available
                    || externalApiAvailability.reason === 'home_not_public_https'
                ) ? (
                    <Item
                        testID="team-credential-open-external-api"
                        title={t('teams.credentials.externalApi.title')}
                        detail={externalApiAvailability.available
                            ? t('teams.credentials.state.available')
                            : externalApiAvailability.reason === 'home_not_public_https'
                                ? t('teams.credentials.externalApi.publicHttpsRequired')
                                : t('teams.credentials.externalApi.unavailable')}
                        onPress={() => router.push(teamCredentialExternalApiPath(context.address, resourceId))}
                    />
                ) : null}
                {context.canMutate && (capabilities.updateBrokerPlacement || capabilities.narrowDisclosure || capabilities.managePolicy) ? (
                    <Item
                        testID="team-credential-open-edit"
                        title={t('teams.credentials.detail.edit')}
                        onPress={() => router.push(teamCredentialEditPath(context.address, resourceId))}
                    />
                ) : null}
            </ItemGroup>

            {((resource.enabled && capabilities.disable) || (!resource.enabled && capabilities.enable) || capabilities.delete) ? (
                <ItemGroup>
                    {((resource.enabled && capabilities.disable) || (!resource.enabled && capabilities.enable)) ? <Item
                        testID="team-credential-toggle-enabled"
                        title={resource.enabled ? t('common.disable') : t('common.enable')}
                        disabled={busy}
                        onPress={async () => {
                            const requestedTargetKey = targetKey;
                            if (resource.enabled) {
                                const confirmed = await Modal.confirm(
                                    t('common.disable'),
                                    t('teams.credentials.delete.body'),
                                    { confirmText: t('common.disable'), destructive: true },
                                );
                                if (!confirmed) return;
                            }
                            if (currentTargetKey.current !== requestedTargetKey) return;
                            setMutating(true);
                            setNotice(null);
                            try {
                                const outcome = await updateTeamCredentialResource({
                                    scope: context.scope,
                                    address: context.address,
                                    resourceId,
                                    expectedRevision: resource.revision,
                                    enabled: !resource.enabled,
                                    ...(resource.enabled ? { confirmedByPresentUser: true } : {}),
                                    handlers: {
                                        // The projection was already invalidated
                                        // for this exact Team when the approval
                                        // executed; clearing the notice is what
                                        // tells the person their change landed.
                                        onApprovalSucceeded: () => {
                                            if (currentTargetKey.current !== requestedTargetKey) return;
                                            setNotice(null);
                                            void view.reload();
                                        },
                                        onApprovalFailed: (code) => {
                                            if (currentTargetKey.current !== requestedTargetKey) return;
                                            setNotice(credentialApprovalFailureMessage(code));
                                        },
                                    },
                                });
                                if (currentTargetKey.current !== requestedTargetKey) return;
                                if (outcome.kind === 'succeeded') {
                                    await view.reload();
                                } else {
                                    setNotice(credentialFailureMessage(outcome.failure));
                                }
                            } catch (cause) {
                                if (currentTargetKey.current !== requestedTargetKey) return;
                                if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.registration);
                                else setNotice(t('teams.errors.generic'));
                            } finally {
                                if (currentTargetKey.current === requestedTargetKey) setMutating(false);
                            }
                        }}
                        showChevron={false}
                    /> : null}
                    {capabilities.delete ? <Item
                        testID="team-credential-delete"
                        title={t('teams.credentials.delete.action')}
                        destructive
                        disabled={busy}
                        onPress={async () => {
                            const requestedTargetKey = targetKey;
                            // The consequence is named before the mutation, and
                            // the copy claims only what deletion can do: future
                            // use stops, already delivered material does not.
                            const confirmed = await Modal.confirm(
                                t('teams.credentials.delete.title', { name: resource.displayName }),
                                t('teams.credentials.delete.body'),
                                { confirmText: t('teams.credentials.delete.action'), destructive: true },
                            );
                            if (!confirmed) return;
                            if (currentTargetKey.current !== requestedTargetKey) return;
                            setMutating(true);
                            setNotice(null);
                            try {
                                const outcome = await deleteTeamCredentialResource({
                                    scope: context.scope,
                                    address: context.address,
                                    resourceId,
                                    expectedRevision: resource.revision,
                                    confirmedByPresentUser: true,
                                    handlers: {
                                        // The resource this screen is about no
                                        // longer exists once the approval runs,
                                        // so staying here would render a
                                        // not-found page over a completed
                                        // action. Leave exactly as an immediate
                                        // delete leaves.
                                        onApprovalSucceeded: () => {
                                            if (currentTargetKey.current !== requestedTargetKey) return;
                                            router.replace(teamCredentialsPath(context.address));
                                        },
                                        onApprovalFailed: (code) => {
                                            if (currentTargetKey.current !== requestedTargetKey) return;
                                            setNotice(credentialApprovalFailureMessage(code));
                                        },
                                    },
                                });
                                if (currentTargetKey.current !== requestedTargetKey) return;
                                if (outcome.kind === 'succeeded') {
                                    router.replace(teamCredentialsPath(context.address));
                                    return;
                                }
                                // The Home named this refusal; the screen shows
                                // the recovery that refusal actually implies.
                                setNotice(credentialFailureMessage(outcome.failure));
                            } catch (cause) {
                                if (currentTargetKey.current !== requestedTargetKey) return;
                                if (isTeamActionApprovalPendingError(cause)) context.requestApproval(cause.registration);
                                else setNotice(t('teams.errors.generic'));
                            } finally {
                                if (currentTargetKey.current === requestedTargetKey) setMutating(false);
                            }
                        }}
                        showChevron={false}
                    /> : null}
                </ItemGroup>
            ) : null}
        </>
    );
});

export const TeamCredentialDetailScreen = React.memo(function TeamCredentialDetailScreen(props: Readonly<{
    serverId: string;
    teamId: string;
    resourceId: string;
}>) {
    return (
        <TeamSection serverId={props.serverId} teamId={props.teamId} title={t('teams.credentials.title')}>
            {(context) => <CredentialDetail context={context} resourceId={props.resourceId} />}
        </TeamSection>
    );
});
