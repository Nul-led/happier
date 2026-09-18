import * as React from 'react';
import {
    HomeTeamProviderPolicyV1Schema,
    type HomeAdmissionModeV1,
    type HomeAuthenticationPolicyV1,
    type HomeIdentityDeploymentServicesV1,
    type HomeIdentityNetworkPolicyV1,
    type HomeTeamProviderPolicyV1,
    type ManagedIdentityProviderKindV1,
    type TeamCreationPolicyV1,
} from '@happier-dev/protocol/home/governance';

import { FieldItem } from '@/components/ui/forms/FieldItem';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text, TextInput } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import type { HomeDomainFailure } from '@/sync/api/home/homeServerActionTransport';
import {
    setHomeAuthenticationPolicies,
    setHomeTeamCreationPolicy,
} from '@/sync/ops/home/homeGovernanceOperations';
import { t } from '@/text';

import { HomeAdministrationSection } from './HomeAdministrationSection';
import type { HomeAdministrationContext } from './homeAdministrationContext';
import {
    homeAdmissionModeLabel,
    homeGovernanceFailureNotice,
    teamCreationPolicyDescription,
    teamCreationPolicyLabel,
} from './homeGovernanceLabels';
import { ManagedIdentityProvidersSection } from '../identity/ManagedIdentityProvidersSection';
import {
    homeManagedGitHubAppCreatePath,
    homeManagedGitHubAppSurface,
    ManagedGitHubAppsSection,
} from '../githubApps/ManagedGitHubAppsSection';

const TEAM_CREATION_CHOICES: readonly TeamCreationPolicyV1[] = ['self_service', 'managed_only', 'disabled'];
const TEAM_PROVIDER_KINDS: readonly ManagedIdentityProviderKindV1[] = [
    'workos_sso',
    'oidc',
    'github_app_identity',
];

function teamProviderKindLabel(kind: ManagedIdentityProviderKindV1): string {
    switch (kind) {
        case 'workos_sso': return 'WorkOS';
        case 'oidc': return 'OpenID Connect';
        case 'github_app_identity': return 'GitHub';
    }
}

/**
 * Team creation, edited through the Home's single revision-guarded policy
 * mutation.
 *
 * The selection is never shown as applied before the Home confirms it. On a
 * revision conflict the administrator's choice is deliberately kept on screen:
 * they still want it, they simply need to see what changed underneath and apply
 * it again.
 */
export const TeamCreationPolicyEditor = React.memo(function TeamCreationPolicyEditor(
    props: Readonly<{ context: HomeAdministrationContext }>,
) {
    const { context } = props;
    const { projection, scope, mutationsAvailable } = context;
    const committed = projection.policy.teamCreationPolicy;

    const [pending, setPending] = React.useState<TeamCreationPolicyV1 | null>(null);
    // The Home's own refusal, kept so the retry row can say what actually
    // happened instead of one sentence that also has to cover a lost answer.
    const [saveFailure, setSaveFailure] = React.useState<HomeDomainFailure | null>(null);
    // The shell owns the shared-approval artifact and releases it on execution,
    // rejection and failure. Latching it here would keep saying "waiting" after
    // a terminal decision the shell has already acted on.
    const approvalPending = context.approvalPending;
    const operationInFlightRef = React.useRef<symbol | null>(null);
    // A conflicted choice outlives the failed save so it can be applied again.
    const [draft, setDraft] = React.useState<TeamCreationPolicyV1 | null>(null);

    // The editor is reusable on its own, so it discards a draft entered for
    // another Home/Account from its own props rather than relying on the host
    // that currently mounts it.
    React.useEffect(() => {
        operationInFlightRef.current = null;
        setDraft(null);
        setPending(null);
        setSaveFailure(null);
    }, [scope.serverId, scope.accountId]);

    // Once the Home reports the value the administrator wanted, the local draft
    // has served its purpose and the projection becomes the only truth again.
    React.useEffect(() => {
        setDraft((current) => (current === null || current === committed ? null : current));
        setSaveFailure(null);
    }, [committed]);

    const editable = projection.capabilities.manageTeamCreationPolicy;
    const selected = draft ?? committed;

    const choose = React.useCallback(async (next: TeamCreationPolicyV1) => {
        if (operationInFlightRef.current !== null || (next === selected && draft === null)) return;
        const operationIdentity = Symbol('team-creation-policy');
        operationInFlightRef.current = operationIdentity;
        setDraft(next);
        setSaveFailure(null);
        setPending(next);
        try {
            const outcome = await setHomeTeamCreationPolicy({
                scope,
                expectedRevision: projection.policy.revision,
                teamCreationPolicy: next,
            });
            if (operationInFlightRef.current !== operationIdentity) return;
            if (outcome.kind === 'succeeded') return;
            if (outcome.kind === 'approval_pending') {
                context.requestApproval?.(outcome.artifactId);
                return;
            }
            if (outcome.kind === 'failed' && outcome.failure.code === 'home_policy_revision_conflict') {
                await Modal.alertAsync(
                    t('homeGovernance.revisionConflictTitle'),
                    t('homeGovernance.revisionConflictBody'),
                );
                context.refresh();
                return;
            }
            setSaveFailure(outcome.failure);
        } finally {
            if (operationInFlightRef.current === operationIdentity) {
                operationInFlightRef.current = null;
                setPending(null);
            }
        }
    }, [selected, draft, scope, projection.policy.revision, context]);

    return (
        <ItemGroup
            title={t('homeGovernance.teamCreation')}
            footer={editable
                ? (mutationsAvailable ? undefined : t('homeGovernance.reasonHomeUnreachable'))
                : t('homeGovernance.policyReadOnly')}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('homeGovernance.teamCreation')}
        >
            {TEAM_CREATION_CHOICES.map((choice) => (
                <Item
                    key={choice}
                    testID={`home-policy-team-creation:${choice}`}
                    title={teamCreationPolicyLabel(choice)}
                    subtitle={teamCreationPolicyDescription(choice)}
                    accessibilityRole="radio"
                    webRole="radio"
                    selected={selected === choice}
                    loading={pending === choice}
                    disabled={!editable || !mutationsAvailable || pending !== null}
                    onPress={editable && mutationsAvailable ? () => { void choose(choice); } : undefined}
                    showChevron={false}
                />
            ))}
            {saveFailure ? (
                <Item
                    testID="home-policy-team-creation-retry"
                    title={t('homeGovernance.retry')}
                    subtitle={homeGovernanceFailureNotice(saveFailure).body}
                    disabled={!editable || !mutationsAvailable || pending !== null}
                    onPress={editable && mutationsAvailable && pending === null
                        ? () => { void choose(selected); }
                        : undefined}
                    showChevron={false}
                />
            ) : null}
            {approvalPending ? (
                <Item
                    testID="home-policy-team-creation-approval-pending"
                    title={t('connect.waitingForApproval')}
                    showChevron={false}
                />
            ) : null}
        </ItemGroup>
    );
});

/**
 * The Home's sign-in and admission narrowing, shown as the Home actually stores
 * it.
 *
 * `unreadable` is surfaced as an actionable configuration problem rather than
 * folded into "using the server defaults": collapsing them would tell an
 * operator their narrowing is inactive when the stored document is simply
 * unparseable here. Editing belongs to the effective authentication-policy
 * owner and is not reconstructed locally.
 */
type SignInPolicyDraft = Readonly<{
    enabledMethodIds: readonly string[];
    enabledMethodIdsNarrowed: boolean;
    permittedAccountModes: readonly ('plain' | 'e2ee')[];
    permittedAccountModesNarrowed: boolean;
    recommendedProvisioningMode: 'plain' | 'e2ee' | null;
    recommendedProvisioningModeNarrowed: boolean;
    admission: HomeAdmissionModeV1 | null;
    signInServiceDisabled: boolean;
}>;

function signInPolicyDraftFromContext(context: HomeAdministrationContext): SignInPolicyDraft | null {
    const authentication = context.projection.policy.authentication;
    if (authentication.status === 'unreadable') return null;
    const options = context.projection.authenticationOptions;
    const recommended = authentication.status === 'narrowed'
        ? authentication.recommendedProvisioningMode
        : options.recommendedProvisioningMode;
    const modes = authentication.status === 'narrowed' && authentication.permittedAccountModes
        ? authentication.permittedAccountModes
        : options.permittedAccountModes;
    return {
        enabledMethodIds: authentication.status === 'narrowed' && authentication.enabledMethodIds
            ? authentication.enabledMethodIds
            : options.methods.map((method) => method.id),
        enabledMethodIdsNarrowed: authentication.status === 'narrowed'
            && authentication.enabledMethodIds !== null,
        permittedAccountModes: modes,
        permittedAccountModesNarrowed: authentication.status === 'narrowed'
            && authentication.permittedAccountModes !== null,
        recommendedProvisioningMode: recommended && modes.includes(recommended)
            ? recommended
            : null,
        recommendedProvisioningModeNarrowed: authentication.status === 'narrowed'
            && authentication.recommendedProvisioningMode !== null,
        admission: authentication.status === 'narrowed' ? authentication.admission : null,
        signInServiceDisabled: authentication.status === 'narrowed'
            ? authentication.signInServiceDisabled
            : false,
    };
}

function authenticationPolicyFromDraft(draft: SignInPolicyDraft): HomeAuthenticationPolicyV1 {
    return {
        v: 1,
        ...(draft.enabledMethodIdsNarrowed
            ? { enabledMethodIds: [...draft.enabledMethodIds] }
            : {}),
        ...(draft.permittedAccountModesNarrowed
            ? { permittedAccountModes: [...draft.permittedAccountModes] }
            : {}),
        ...(draft.recommendedProvisioningModeNarrowed && draft.recommendedProvisioningMode
            ? { recommendedProvisioningMode: draft.recommendedProvisioningMode }
            : {}),
        ...(draft.admission ? { admission: draft.admission } : {}),
        signInService: draft.signInServiceDisabled ? { mode: 'disabled' } : null,
    };
}

const SignInPolicyEditor = React.memo(function SignInPolicyEditor(
    props: Readonly<{ context: HomeAdministrationContext }>,
) {
    const { context } = props;
    const authentication = context.projection.policy.authentication;
    const options = context.projection.authenticationOptions;
    const committed = signInPolicyDraftFromContext(context);
    const committedKey = committed ? JSON.stringify(committed) : '';
    const [draft, setDraft] = React.useState<SignInPolicyDraft | null>(null);
    const [saving, setSaving] = React.useState(false);
    const approvalPending = context.approvalPending;
    const operationInFlightRef = React.useRef<symbol | null>(null);
    const selected = draft ?? committed;
    const editable = context.projection.capabilities.manageAuthentication
        && context.mutationsAvailable
        && authentication.status !== 'unreadable';

    React.useEffect(() => {
        operationInFlightRef.current = null;
        setDraft(null);
        setSaving(false);
    }, [context.scope.serverId, context.scope.accountId]);

    React.useEffect(() => {
        setDraft((current) => current && JSON.stringify(current) === committedKey ? null : current);
    }, [committedKey]);

    if (authentication.status === 'unreadable' || !selected) {
        return (
            <ItemGroup title={t('homeGovernance.signInTitle')} footer={t('homeGovernance.authUnreadableDescription')}>
                <Item
                    testID="home-policy-auth-unreadable"
                    title={t('homeGovernance.authUnreadable')}
                    showChevron={false}
                />
            </ItemGroup>
        );
    }

    const offeredMethodIds = new Set(options.methods.map((method) => method.id));
    const methodRows = [
        ...options.methods,
        ...selected.enabledMethodIds
            .filter((id) => !offeredMethodIds.has(id))
            .map((id) => ({ id, displayName: id })),
    ];
    const modeRows = [
        ...options.permittedAccountModes,
        ...selected.permittedAccountModes.filter((mode) => !options.permittedAccountModes.includes(mode)),
    ];
    const validDraft = draft !== null
        && draft.enabledMethodIds.length > 0
        && draft.permittedAccountModes.length > 0
        && draft.recommendedProvisioningMode !== null
        && draft.permittedAccountModes.includes(draft.recommendedProvisioningMode)
        && draft.enabledMethodIds.every((id) => offeredMethodIds.has(id))
        && draft.permittedAccountModes.every((mode) => options.permittedAccountModes.includes(mode));

    const patch = (values: Partial<SignInPolicyDraft>) => setDraft({ ...selected, ...values });
    const toggleMethod = (methodId: string) => {
        const included = selected.enabledMethodIds.includes(methodId);
        if (included && selected.enabledMethodIds.length === 1) return;
        patch({
            enabledMethodIds: included
                ? selected.enabledMethodIds.filter((id) => id !== methodId)
                : [...selected.enabledMethodIds, methodId],
            enabledMethodIdsNarrowed: true,
        });
    };
    const toggleMode = (mode: 'plain' | 'e2ee') => {
        const included = selected.permittedAccountModes.includes(mode);
        if (included && selected.permittedAccountModes.length === 1) return;
        const permittedAccountModes = included
            ? selected.permittedAccountModes.filter((candidate) => candidate !== mode)
            : [...selected.permittedAccountModes, mode];
        patch({
            permittedAccountModes,
            permittedAccountModesNarrowed: true,
            recommendedProvisioningMode: selected.recommendedProvisioningMode !== null
                && permittedAccountModes.includes(selected.recommendedProvisioningMode)
                ? selected.recommendedProvisioningMode
                : null,
            recommendedProvisioningModeNarrowed: selected.recommendedProvisioningMode !== null
                && permittedAccountModes.includes(selected.recommendedProvisioningMode),
        });
    };
    const save = async () => {
        if (operationInFlightRef.current !== null || !draft || draft.enabledMethodIds.length === 0 || draft.permittedAccountModes.length === 0) return;
        const operationIdentity = Symbol('sign-in-policy');
        operationInFlightRef.current = operationIdentity;
        setSaving(true);
        try {
            const outcome = await setHomeAuthenticationPolicies({
                scope: context.scope,
                expectedRevision: context.projection.policy.revision,
                authenticationPolicy: authenticationPolicyFromDraft(draft),
            });
            if (operationInFlightRef.current !== operationIdentity) return;
            if (outcome.kind === 'succeeded') return;
            if (outcome.kind === 'approval_pending') {
                context.requestApproval?.(outcome.artifactId);
                return;
            }
            if (outcome.kind === 'failed' && outcome.failure.code === 'home_policy_revision_conflict') {
                await Modal.alertAsync(
                    t('homeGovernance.revisionConflictTitle'),
                    t('homeGovernance.revisionConflictBody'),
                );
                context.refresh();
                return;
            }
            // The Home's own verdict, not one generic sentence: a save whose
            // answer was lost must not be reported as a save that did not happen.
            const notice = homeGovernanceFailureNotice(outcome.failure);
            await Modal.alertAsync(notice.title, notice.body);
        } finally {
            if (operationInFlightRef.current === operationIdentity) {
                operationInFlightRef.current = null;
                setSaving(false);
            }
        }
    };

    return (
        <>
            <ItemGroup
                title={t('homeGovernance.signInMethods')}
                footer={options.methods.length === 0
                    ? t('homeGovernance.policyEditingUnavailable')
                    : editable ? undefined : (
                        context.mutationsAvailable
                            ? t('homeGovernance.policyReadOnly')
                            : t('homeGovernance.reasonHomeUnreachable')
                    )}
            >
                {methodRows.map((method) => {
                    const checked = selected.enabledMethodIds.includes(method.id);
                    const offered = offeredMethodIds.has(method.id);
                    const canToggle = editable && !saving && (offered || checked)
                        && !(checked && selected.enabledMethodIds.length === 1);
                    return (
                        <Item
                            key={method.id}
                            testID={`home-policy-auth-method:${method.id}`}
                            title={method.displayName ?? method.id}
                            subtitle={offered ? undefined : t('homeGovernance.policyEditingUnavailable')}
                            accessibilityRole="checkbox"
                            webRole="checkbox"
                            selected={checked}
                            disabled={!canToggle}
                            onPress={canToggle ? () => toggleMethod(method.id) : undefined}
                            showChevron={false}
                        />
                    );
                })}
            </ItemGroup>
            <ItemGroup title={t('homeGovernance.accountModes')}>
                {modeRows.map((mode) => {
                    const checked = selected.permittedAccountModes.includes(mode);
                    const offered = options.permittedAccountModes.includes(mode);
                    const canToggle = editable && !saving && (offered || checked)
                        && !(checked && selected.permittedAccountModes.length === 1);
                    return (
                        <Item
                            key={mode}
                            testID={`home-policy-auth-mode:${mode}`}
                            title={mode === 'plain'
                                ? t('homeGovernance.accountModePlain')
                                : t('homeGovernance.accountModeE2ee')}
                            subtitle={offered ? undefined : t('homeGovernance.policyEditingUnavailable')}
                            accessibilityRole="checkbox"
                            webRole="checkbox"
                            selected={checked}
                            disabled={!canToggle}
                            onPress={canToggle ? () => toggleMode(mode) : undefined}
                            showChevron={false}
                        />
                    );
                })}
            </ItemGroup>
            <ItemGroup
                title={t('homeGovernance.recommendedMode')}
                footer={t('homeGovernance.recommendedModeDescription')}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('homeGovernance.recommendedMode')}
            >
                {selected.permittedAccountModes.map((mode) => (
                    <Item
                        key={mode}
                        testID={`home-policy-auth-recommended:${mode}`}
                        title={mode === 'plain'
                            ? t('homeGovernance.accountModePlain')
                            : t('homeGovernance.accountModeE2ee')}
                        accessibilityRole="radio"
                        webRole="radio"
                        selected={selected.recommendedProvisioningMode === mode}
                        disabled={!editable || saving}
                        onPress={editable && !saving ? () => patch({
                            recommendedProvisioningMode: mode,
                            recommendedProvisioningModeNarrowed: true,
                        }) : undefined}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>
            <ItemGroup
                title={t('homeGovernance.admission')}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('homeGovernance.admission')}
            >
                <Item
                    testID="home-policy-auth-admission:inherited"
                    title={t('homeGovernance.authInherited')}
                    accessibilityRole="radio"
                    webRole="radio"
                    selected={selected.admission === null}
                    disabled={!editable || saving}
                    onPress={editable && !saving ? () => patch({ admission: null }) : undefined}
                    showChevron={false}
                />
                {(['self_service', 'invitation_only', 'closed'] as const).map((admission) => (
                    <Item
                        key={admission}
                        testID={`home-policy-auth-admission:${admission}`}
                        title={homeAdmissionModeLabel(admission)}
                        accessibilityRole="radio"
                        webRole="radio"
                        selected={selected.admission === admission}
                        disabled={!editable || saving}
                        onPress={editable && !saving ? () => patch({ admission }) : undefined}
                        showChevron={false}
                    />
                ))}
            </ItemGroup>
            {options.signInService.canDisable || selected.signInServiceDisabled ? (
                <ItemGroup title={t('homeGovernance.signInTitle')}>
                    <Item
                        testID="home-policy-auth-service-disabled"
                        title={t('homeGovernance.signInServiceDisabled')}
                        accessibilityRole="checkbox"
                        webRole="checkbox"
                        selected={selected.signInServiceDisabled}
                        disabled={!editable || saving || !options.signInService.canDisable}
                        onPress={editable && !saving && options.signInService.canDisable
                            ? () => patch({ signInServiceDisabled: !selected.signInServiceDisabled })
                            : undefined}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
            {editable ? (
                <>
                    <Item
                        testID="home-policy-auth-save"
                        title={t('common.save')}
                        loading={saving}
                        disabled={!validDraft || saving}
                        onPress={validDraft ? () => { void save(); } : undefined}
                        showChevron={false}
                    />
                    {approvalPending ? (
                        <Item
                            testID="home-policy-auth-approval-pending"
                            title={t('connect.waitingForApproval')}
                            showChevron={false}
                        />
                    ) : null}
                </>
            ) : null}
        </>
    );
});

function workosDeploymentLabel(state: HomeIdentityDeploymentServicesV1['workos']): string {
    switch (state) {
        case 'configured': return t('homeGovernance.deploymentWorkosConfigured');
        case 'partially_configured': return t('homeGovernance.deploymentWorkosPartial');
        case 'not_configured': return t('homeGovernance.deploymentWorkosNotConfigured');
    }
}

/** One list entry per line, so a pasted allowlist survives unchanged. */
function readLines(value: string): readonly string[] {
    return value.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

type IdentityNetworkDraft = Readonly<{
    mode: HomeIdentityNetworkPolicyV1['mode'];
    hostnames: string;
    cidrs: string;
    ports: string;
}>;

function identityNetworkDraftFromPolicy(policy: HomeIdentityNetworkPolicyV1 | null): IdentityNetworkDraft {
    if (!policy || policy.mode === 'public_only') {
        return { mode: policy?.mode ?? 'public_only', hostnames: '', cidrs: '', ports: '' };
    }
    return {
        mode: 'private_allowlist',
        hostnames: policy.hostnames.join('\n'),
        cidrs: policy.cidrs.join('\n'),
        ports: policy.ports.join('\n'),
    };
}

/**
 * The draft as the Home's own policy value, or `null` when it is not one yet.
 *
 * Shape is decided here so an obviously incomplete allowlist never reaches the
 * network; the Home still validates and remains the deciding authority.
 */
function identityNetworkPolicyFromDraft(draft: IdentityNetworkDraft): HomeIdentityNetworkPolicyV1 | null {
    if (draft.mode === 'public_only') return { v: 1, mode: 'public_only' };
    const hostnames = [...new Set(readLines(draft.hostnames))];
    const cidrs = [...new Set(readLines(draft.cidrs))];
    const ports = [...new Set(readLines(draft.ports).map((port) => Number(port)))];
    if (hostnames.length === 0 && cidrs.length === 0) return null;
    if (ports.length === 0) return null;
    if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) return null;
    return { v: 1, mode: 'private_allowlist', hostnames, cidrs, ports };
}

/**
 * The deployment's identity-service ceiling, and the private-endpoint policy a
 * self-hosted Home may narrow inside it.
 *
 * The private section is absent — not disabled — where the deployment can never
 * permit private endpoints, because there is no action an administrator of a
 * cloud or shared Home could take there. When the Home does not report these
 * facts at all, both sections stay away rather than inventing a deployment
 * answer the server never gave.
 */
const HomeIdentityDeploymentSections = React.memo(function HomeIdentityDeploymentSections(
    props: Readonly<{ context: HomeAdministrationContext }>,
) {
    const { context } = props;
    const services = context.projection.identityServices;
    const networkRead = context.projection.policy.identityNetwork;
    const committed = networkRead?.status === 'narrowed' ? networkRead.policy : null;
    const [draft, setDraft] = React.useState<IdentityNetworkDraft | null>(null);
    const [saving, setSaving] = React.useState(false);
    const [invalid, setInvalid] = React.useState(false);
    const operationInFlightRef = React.useRef<symbol | null>(null);
    // The draft the administrator has typed so far, readable from an event
    // handler that has not re-rendered yet. Editing three fields and pressing
    // Save in the same beat must submit all three, not the last one over an
    // empty list.
    const draftRef = React.useRef<IdentityNetworkDraft | null>(null);
    React.useEffect(() => {
        // A route changing Homes is a different authority and policy document;
        // only a refresh of this same exact Home is allowed to retain the draft.
        draftRef.current = null;
        operationInFlightRef.current = null;
        setDraft(null);
        setInvalid(false);
    }, [context.scope.serverId, context.scope.accountId]);

    if (!services) return null;
    const editable = context.projection.capabilities.manageAuthentication && context.mutationsAvailable;
    const current = draft ?? identityNetworkDraftFromPolicy(committed);
    const patch = (values: Partial<IdentityNetworkDraft>) => {
        const next = { ...(draftRef.current ?? identityNetworkDraftFromPolicy(committed)), ...values };
        draftRef.current = next;
        setInvalid(false);
        setDraft(next);
    };

    const save = async () => {
        if (operationInFlightRef.current !== null) return;
        const policy = identityNetworkPolicyFromDraft(
            draftRef.current ?? identityNetworkDraftFromPolicy(committed),
        );
        if (!policy) { setInvalid(true); return; }
        const operationIdentity = Symbol('identity-network-policy');
        operationInFlightRef.current = operationIdentity;
        setInvalid(false);
        setSaving(true);
        try {
            const outcome = await setHomeAuthenticationPolicies({
                scope: context.scope,
                expectedRevision: context.projection.policy.revision,
                identityNetworkPolicy: policy,
            });
            if (operationInFlightRef.current !== operationIdentity) return;
            if (outcome.kind === 'succeeded') {
                // The mutation owner has already refreshed this exact Home by
                // the time it returns. Adopt that committed value and leave no
                // stale local editor state behind.
                draftRef.current = null;
                setDraft(null);
                return;
            }
            if (outcome.kind === 'approval_pending') {
                context.requestApproval?.(outcome.artifactId);
                return;
            }
            if (outcome.kind === 'failed' && outcome.failure.code === 'home_policy_revision_conflict') {
                await Modal.alertAsync(
                    t('homeGovernance.revisionConflictTitle'),
                    t('homeGovernance.revisionConflictBody'),
                );
                context.refresh();
                return;
            }
            // The Home's own verdict, not one generic sentence: a save whose
            // answer was lost must not be reported as a save that did not happen.
            const notice = homeGovernanceFailureNotice(outcome.failure);
            await Modal.alertAsync(notice.title, notice.body);
        } finally {
            if (operationInFlightRef.current === operationIdentity) {
                operationInFlightRef.current = null;
                setSaving(false);
            }
        }
    };

    return (
        <>
            <ItemGroup
                title={t('homeGovernance.deploymentServices')}
                footer={t('homeGovernance.deploymentServicesDescription')}
            >
                <Item
                    testID="home-policy-deployment-workos"
                    title={t('identityAdministration.workos')}
                    detail={workosDeploymentLabel(services.workos)}
                    showChevron={false}
                />
            </ItemGroup>
            {services.privateIdentityNetworkAllowed ? (
                <ItemGroup
                    title={t('homeGovernance.privateEndpoints')}
                    footer={networkRead?.status === 'unreadable'
                        ? t('homeGovernance.privateEndpointsUnreadable')
                        : invalid
                            ? t('homeGovernance.privateEndpointsInvalid')
                            : t('homeGovernance.privateEndpointsDescription')}
                >
                    <Item
                        testID="home-policy-identity-network-mode:public_only"
                        title={t('homeGovernance.privateEndpointsPublicOnly')}
                        accessibilityRole="radio"
                        webRole="radio"
                        selected={current.mode === 'public_only'}
                        disabled={!editable || saving}
                        onPress={editable ? () => patch({ mode: 'public_only' }) : undefined}
                        showChevron={false}
                    />
                    <Item
                        testID="home-policy-identity-network-mode:private_allowlist"
                        title={t('homeGovernance.privateEndpointsAllowlist')}
                        accessibilityRole="radio"
                        webRole="radio"
                        selected={current.mode === 'private_allowlist'}
                        disabled={!editable || saving}
                        onPress={editable ? () => patch({ mode: 'private_allowlist' }) : undefined}
                        showChevron={false}
                    />
                    {current.mode === 'private_allowlist' ? (
                        <>
                            <FieldItem label={t('homeGovernance.privateEndpointsHostnames')}>
                                <TextInput
                                    testID="home-policy-identity-network-hostnames"
                                    accessibilityLabel={t('homeGovernance.privateEndpointsHostnames')}
                                    value={current.hostnames}
                                    editable={editable && !saving}
                                    multiline
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    onChangeText={(value) => patch({ hostnames: value })}
                                />
                            </FieldItem>
                            <FieldItem label={t('homeGovernance.privateEndpointsCidrs')}>
                                <TextInput
                                    testID="home-policy-identity-network-cidrs"
                                    accessibilityLabel={t('homeGovernance.privateEndpointsCidrs')}
                                    value={current.cidrs}
                                    editable={editable && !saving}
                                    multiline
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    onChangeText={(value) => patch({ cidrs: value })}
                                />
                            </FieldItem>
                            <FieldItem label={t('homeGovernance.privateEndpointsPorts')}>
                                <TextInput
                                    testID="home-policy-identity-network-ports"
                                    accessibilityLabel={t('homeGovernance.privateEndpointsPorts')}
                                    value={current.ports}
                                    editable={editable && !saving}
                                    multiline
                                    keyboardType="number-pad"
                                    onChangeText={(value) => patch({ ports: value })}
                                />
                            </FieldItem>
                        </>
                    ) : null}
                    {editable ? (
                        <Item
                            testID="home-policy-identity-network-save"
                            title={t('homeGovernance.privateEndpointsSave')}
                            loading={saving}
                            disabled={saving}
                            onPress={() => void save()}
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>
            ) : null}
        </>
    );
});

/**
 * Authentication policy controls contributed to the existing Home Policies
 * page. This edits the Home-wide Team provider ceiling through the same
 * revision-guarded policy owner as the rest of Home governance.
 *
 * An inherited or unreadable policy is shown as-is. The UI does not fabricate
 * the deployment ceiling needed to turn either state into an editable list.
 */
export const HomeAuthenticationPolicySections = React.memo(function HomeAuthenticationPolicySections(
    props: Readonly<{ context: HomeAdministrationContext }>,
) {
    const { context } = props;
    const providerRead = context.projection.policy.teamProviders;
    const [draft, setDraft] = React.useState<Readonly<{
        allowedTeamProviderKinds?: readonly ManagedIdentityProviderKindV1[];
        teamJitAllowed?: boolean;
    }> | null>(null);
    const [originsDraft, setOriginsDraft] = React.useState<string | null>(null);
    const [pending, setPending] = React.useState<ManagedIdentityProviderKindV1 | 'jit' | 'origins' | null>(null);
    const approvalPending = context.approvalPending;
    const [approvalChange, setApprovalChange] = React.useState<Readonly<{
        changed: ManagedIdentityProviderKindV1 | 'jit';
        observedPending: boolean;
    }> | null>(null);
    const operationInFlightRef = React.useRef<symbol | null>(null);

    const discardOptimisticChange = React.useCallback((changed: ManagedIdentityProviderKindV1 | 'jit' | 'origins') => {
        // Origins are an explicit text draft with an explicit Save action. A
        // rejected automatic checkbox mutation must not erase that unrelated
        // authored text, and an origins refusal deliberately leaves it ready
        // for correction/retry.
        if (changed === 'origins') return;
        setDraft((current) => {
            if (!current) return current;
            const next = { ...current };
            if (changed === 'jit') delete next.teamJitAllowed;
            else delete next.allowedTeamProviderKinds;
            return Object.keys(next).length > 0 ? next : null;
        });
    }, []);

    React.useEffect(() => {
        operationInFlightRef.current = null;
        setDraft(null);
        setOriginsDraft(null);
        setPending(null);
        setApprovalChange(null);
    }, [context.scope.serverId, context.scope.accountId]);

    const committed = providerRead?.status === 'narrowed' ? providerRead.policy : null;
    const committedKey = committed ? JSON.stringify(committed) : '';
    React.useEffect(() => {
        setDraft((current) => {
            if (!current) return current;
            if (!committed) return null;
            const next = {
                ...(current.allowedTeamProviderKinds
                    && JSON.stringify(current.allowedTeamProviderKinds)
                        !== JSON.stringify(committed.allowedTeamProviderKinds)
                    ? { allowedTeamProviderKinds: current.allowedTeamProviderKinds }
                    : {}),
                ...(current.teamJitAllowed !== undefined
                    && current.teamJitAllowed !== committed.teamJitAllowed
                    ? { teamJitAllowed: current.teamJitAllowed }
                    : {}),
            };
            return Object.keys(next).length > 0 ? next : null;
        });
        setOriginsDraft((current) => {
            if (current === null) return current;
            if (!committed) return null;
            const candidate = HomeTeamProviderPolicyV1Schema.safeParse({
                ...committed,
                approvedGitHubEnterpriseOrigins: readLines(current),
            });
            return candidate.success
                && JSON.stringify(candidate.data.approvedGitHubEnterpriseOrigins)
                    === JSON.stringify(committed.approvedGitHubEnterpriseOrigins)
                ? null
                : current;
        });
    }, [committedKey]);

    // The shell is the approval lifecycle owner. The checkbox candidate is
    // shown while that artifact is genuinely pending, then discarded when the
    // shell reports a terminal outcome. On executed success the shell refreshes
    // the same Home, so the next render adopts the authoritative committed
    // policy rather than preserving this optimistic candidate as local truth.
    React.useEffect(() => {
        if (!approvalChange) return;
        if (approvalPending) {
            if (!approvalChange.observedPending) {
                setApprovalChange({ ...approvalChange, observedPending: true });
            }
            return;
        }
        if (!approvalChange.observedPending) return;
        discardOptimisticChange(approvalChange.changed);
        setApprovalChange(null);
    }, [approvalChange, approvalPending, discardOptimisticChange]);

    const selected = committed && draft ? { ...committed, ...draft } : committed;
    const editable = context.projection.capabilities.manageAuthentication && context.mutationsAvailable;

    const save = React.useCallback(async (
        next: HomeTeamProviderPolicyV1,
        changed: ManagedIdentityProviderKindV1 | 'jit' | 'origins',
    ) => {
        if (operationInFlightRef.current !== null) return;
        const operationIdentity = Symbol('team-provider-policy');
        operationInFlightRef.current = operationIdentity;
        setPending(changed);
        try {
            const outcome = await setHomeAuthenticationPolicies({
                scope: context.scope,
                expectedRevision: context.projection.policy.revision,
                teamProviderPolicy: next,
            });
            if (operationInFlightRef.current !== operationIdentity) return;
            if (outcome.kind === 'succeeded') {
                setApprovalChange(null);
                return;
            }
            if (outcome.kind === 'approval_pending') {
                if (!context.requestApproval) {
                    // Without a shell lifecycle owner there is no truthful
                    // pending state to retain. Explicit text remains available
                    // to retry, while automatic toggles return to committed.
                    discardOptimisticChange(changed);
                    return;
                }
                if (changed !== 'origins') {
                    setApprovalChange({ changed, observedPending: context.approvalPending });
                }
                context.requestApproval(outcome.artifactId);
                return;
            }
            discardOptimisticChange(changed);
            if (outcome.kind === 'failed' && outcome.failure.code === 'home_policy_revision_conflict') {
                await Modal.alertAsync(
                    t('homeGovernance.revisionConflictTitle'),
                    t('homeGovernance.revisionConflictBody'),
                );
                context.refresh();
                return;
            }
            // The Home's own verdict, not one generic sentence: a save whose
            // answer was lost must not be reported as a save that did not happen.
            const notice = homeGovernanceFailureNotice(outcome.failure);
            await Modal.alertAsync(notice.title, notice.body);
        } finally {
            if (operationInFlightRef.current === operationIdentity) {
                operationInFlightRef.current = null;
                setPending(null);
            }
        }
    }, [context, discardOptimisticChange]);

    const toggleProvider = React.useCallback((kind: ManagedIdentityProviderKindV1) => {
        if (!selected || pending !== null) return;
        const enabled = selected.allowedTeamProviderKinds.includes(kind);
        const allowedTeamProviderKinds = TEAM_PROVIDER_KINDS.filter((candidate) => (
            candidate === kind ? !enabled : selected.allowedTeamProviderKinds.includes(candidate)
        ));
        setDraft((current) => ({ ...current, allowedTeamProviderKinds }));
        void save({ ...selected, allowedTeamProviderKinds }, kind);
    }, [pending, save, selected]);

    const toggleJit = React.useCallback(() => {
        if (!selected || pending !== null) return;
        const teamJitAllowed = !selected.teamJitAllowed;
        setDraft((current) => ({ ...current, teamJitAllowed }));
        void save({
            ...selected,
            allowedTeamProviderKinds: [...selected.allowedTeamProviderKinds],
            teamJitAllowed,
        }, 'jit');
    }, [pending, save, selected]);

    const originsText = originsDraft
        ?? selected?.approvedGitHubEnterpriseOrigins.join('\n')
        ?? '';
    const originsCandidate = selected
        ? HomeTeamProviderPolicyV1Schema.safeParse({
            ...selected,
            approvedGitHubEnterpriseOrigins: readLines(originsText),
        })
        : null;
    const originsValid = originsCandidate?.success === true;
    const saveOrigins = React.useCallback(() => {
        if (!originsCandidate?.success || originsDraft === null || pending !== null) return;
        void save(originsCandidate.data, 'origins');
    }, [originsCandidate, originsDraft, pending, save]);

    if (!providerRead) {
        return (
            <>
                <SignInPolicyEditor context={context} />
                <HomeIdentityDeploymentSections context={context} />
            </>
        );
    }

    if (providerRead.status === 'inherited') {
        return (
            <>
                <SignInPolicyEditor context={context} />
                <ItemGroup title={t('homeGovernance.manageTeams')} footer={t('homeGovernance.authInheritedDescription')}>
                    <Item testID="home-policy-team-providers-inherited" title={t('homeGovernance.authInherited')} showChevron={false} />
                </ItemGroup>
                <HomeIdentityDeploymentSections context={context} />
            </>
        );
    }

    if (providerRead.status === 'unreadable') {
        return (
            <>
                <SignInPolicyEditor context={context} />
                <ItemGroup title={t('homeGovernance.manageTeams')} footer={t('homeGovernance.authUnreadableDescription')}>
                    <Item testID="home-policy-team-providers-unreadable" title={t('homeGovernance.authUnreadable')} showChevron={false} />
                </ItemGroup>
                <HomeIdentityDeploymentSections context={context} />
            </>
        );
    }

    return (
        <>
            <SignInPolicyEditor context={context} />
            <ItemGroup
                title={t('homeGovernance.manageTeams')}
                footer={editable ? undefined : (
                    context.mutationsAvailable
                        ? t('homeGovernance.policyReadOnly')
                        : t('homeGovernance.reasonHomeUnreachable')
                )}
            >
                {TEAM_PROVIDER_KINDS.map((kind) => {
                    const checked = selected?.allowedTeamProviderKinds.includes(kind) === true;
                    return (
                        <Item
                            key={kind}
                            testID={`home-policy-team-provider:${kind}`}
                            title={teamProviderKindLabel(kind)}
                            accessibilityRole="checkbox"
                            webRole="checkbox"
                            selected={checked}
                            loading={pending === kind}
                            disabled={!editable || pending !== null}
                            onPress={editable ? () => toggleProvider(kind) : undefined}
                            showChevron={false}
                        />
                    );
                })}
                <Item
                    testID="home-policy-team-jit"
                    title={t('homeGovernance.teamJit')}
                    subtitle={t('homeGovernance.teamJitDescription')}
                    accessibilityRole="checkbox"
                    webRole="checkbox"
                    selected={selected?.teamJitAllowed === true}
                    loading={pending === 'jit'}
                    disabled={!editable || pending !== null}
                    onPress={editable ? toggleJit : undefined}
                    showChevron={false}
                />
                <FieldItem
                    label={t('homeGovernance.githubEnterpriseOrigins')}
                    supportingText={originsDraft !== null && !originsValid
                        ? (
                            <Text testID="home-policy-team-provider-origins-invalid">
                                {t('homeGovernance.githubEnterpriseOriginsInvalid')}
                            </Text>
                        )
                        : t('homeGovernance.githubEnterpriseOriginsDescription')}
                >
                    <TextInput
                        testID="home-policy-team-provider-origins"
                        accessibilityLabel={t('homeGovernance.githubEnterpriseOrigins')}
                        value={originsText}
                        editable={editable && pending === null}
                        multiline
                        autoCapitalize="none"
                        autoCorrect={false}
                        onChangeText={setOriginsDraft}
                    />
                </FieldItem>
                <Item
                    testID="home-policy-team-provider-origins-save"
                    title={t('common.save')}
                    loading={pending === 'origins'}
                    disabled={!editable || pending !== null || originsDraft === null || !originsValid}
                    onPress={editable && pending === null && originsDraft !== null && originsValid
                        ? saveOrigins
                        : undefined}
                    showChevron={false}
                />
                {approvalPending ? (
                    <Item
                        testID="home-policy-team-provider-approval-pending"
                        title={t('connect.waitingForApproval')}
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>
            <HomeIdentityDeploymentSections context={context} />
        </>
    );
});

export const HomeAdministrationPoliciesScreen = React.memo(function HomeAdministrationPoliciesScreen(
    props: Readonly<{ serverId: string }>,
) {
    return (
        <HomeAdministrationSection serverId={props.serverId} title={t('homeGovernance.policies')}>
            {(context) => (
                <>
                    <TeamCreationPolicyEditor context={context} />
                    {context.projection.capabilities.manageAuthentication ? (
                        <>
                            <ManagedIdentityProvidersSection context={context} />
                            <ManagedGitHubAppsSection surface={homeManagedGitHubAppSurface(context)} createPath={homeManagedGitHubAppCreatePath(context)} />
                            <HomeAuthenticationPolicySections context={context} />
                        </>
                    ) : null}
                </>
            )}
        </HomeAdministrationSection>
    );
});
