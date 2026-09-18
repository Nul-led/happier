import * as React from 'react';
import type {
    TeamAcceptedAuthenticationV1,
    TeamAuthenticationPolicyV1,
} from '@happier-dev/protocol';
import {
    TeamErrorV1Schema,
    type TeamAdmissionModeApplicabilityV1,
    type TeamAdmissionModeV1,
    type TeamAuthenticationPolicyComparisonBasisV1,
    type TeamIdentityConnectionV1,
} from '@happier-dev/protocol/teams';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { setTeamPolicy } from '@/sync/ops/teams/teamOperations';
import { isTeamActionApprovalPendingError } from '@/sync/ops/teams/teamActionClient';
import { t } from '@/text';

import type { TeamSectionContext } from '../teamSectionContext';
import { teamMutationFailureLabel } from '../teamMutationPresentation';
import { identityConnectionDiscriminator } from './identityAdministrationPresentation';

const ADMISSION_MODES: readonly TeamAdmissionModeV1[] = Object.freeze([
    'invite_only',
    'provisioned',
    'jit',
]);

function admissionModeLabel(mode: TeamAdmissionModeV1): string {
    switch (mode) {
        case 'invite_only': return t('teams.authentication.policy.admissionInviteOnly');
        case 'provisioned': return t('teams.authentication.policy.admissionProvisioned');
        case 'jit': return t('teams.authentication.policy.admissionJit');
    }
}

type UnavailableAdmissionMode = Extract<
    TeamAdmissionModeApplicabilityV1['modes'][TeamAdmissionModeV1],
    { status: 'unavailable' }
>;

/**
 * The Home's own reason, in copy written for that exact reason.
 *
 * Each branch owns one localized sentence rather than assembling neighbouring
 * section copy with hardcoded punctuation: the sentence order, spacing and
 * wording belong to the locale, and an administrator reading "a Home
 * administrator does not allow this" must not be told the same thing as one
 * whose Home simply has not published that provider yet. The reason is the key,
 * so the same explanation appears wherever a mode carries it.
 */
function admissionModeUnavailableLabel(availability: UnavailableAdmissionMode): string {
    switch (availability.reason) {
        case 'home_policy_unavailable':
            return t('teams.authentication.policy.admissionUnavailableReason.homePolicyUnavailable');
        case 'home_policy_prohibited':
            return t('teams.authentication.policy.admissionUnavailableReason.homePolicyProhibited');
        case 'directory_source_required':
            return t('teams.authentication.policy.admissionUnavailableReason.directorySourceRequired');
        case 'directory_projection_required':
            return t('teams.authentication.policy.admissionUnavailableReason.directoryProjectionRequired');
        case 'team_connection_required':
            return t('teams.authentication.policy.admissionUnavailableReason.teamConnectionRequired');
        case 'team_connection_unavailable':
            return t('teams.authentication.policy.admissionUnavailableReason.teamConnectionUnavailable');
    }
}

function acceptedKey(reference: TeamAcceptedAuthenticationV1): string {
    return reference.kind === 'home_method'
        ? `home_method:${reference.methodId.toLowerCase()}`
        : `team_connection:${reference.connectionId}`;
}

/**
 * The Home's refusal, said in the words that describe what actually happened.
 *
 * `team_authentication_policy_unavailable` is the Home reporting that it cannot
 * currently enforce the requested policy — for example because accepted
 * sign-in has not been proven against the live provider, or because admission
 * evidence changed after the list projection was read. It is never
 * reinterpreted here as a client-side ceiling: the Home's own answer is what
 * the administrator reads.
 */
function policyFailureLabel(failure: Readonly<{ code: string | null; details?: unknown }>): string | null {
    if (failure.code === 'team_authentication_policy_unavailable') {
        const domainError = TeamErrorV1Schema.safeParse(failure.details);
        return domainError.success
            && domainError.data.error === failure.code
            && domainError.data.details?.reason === 'provider_test_required'
            ? t('teams.authentication.policy.providerTestRequired')
            : t('teams.authentication.policy.unavailable');
    }
    return null;
}

/**
 * Admission and accepted sign-in for one exact Team, written through the single
 * revision-guarded `teams.policy.set` owner.
 *
 * Accepted sign-in is compare-and-set: the Home requires the canonical value the
 * editor actually read, so a policy that moved underneath is refused rather than
 * silently overwritten. The basis is captured when the draft begins and is only
 * advanced by an explicit acknowledgement of the newly observed policy, so the
 * administrator's intent survives the conflict instead of being discarded.
 *
 * Only references this Team owns are offered. A `home_method` already present in
 * the stored policy is shown and preserved, but it cannot be added here: the
 * Team surface has no Home sign-in-method projection, and inventing one would
 * both duplicate the Home policy owner and disclose Home configuration to a Team
 * administrator who may not read it.
 */
export const TeamAuthenticationPolicySections = React.memo(function TeamAuthenticationPolicySections(
    props: Readonly<{
        context: TeamSectionContext;
        connections: readonly TeamIdentityConnectionV1[];
        /** False while the connection projection is absent, refreshing or stale. */
        connectionsCurrent: boolean;
        admissionModeApplicability: TeamAdmissionModeApplicabilityV1 | null;
    }>,
) {
    const { context, connections, connectionsCurrent, admissionModeApplicability } = props;
    const policy = context.team.policy;
    const repairRequired = policy.authenticationPolicyStatus === 'repair_required';

    // The exact value the Home says it holds right now, in the shape its
    // compare-and-set input expects. Unreadable persisted policy has its own
    // basis: it is not inheritance and must not be compared as null.
    const observedBasis: TeamAuthenticationPolicyComparisonBasisV1 = repairRequired
        ? { v: 1, status: 'repair_required' }
        : policy.authenticationPolicy;
    const observedBasisKey = JSON.stringify(observedBasis);

    const [draft, setDraft] = React.useState<TeamAuthenticationPolicyV1 | null>(null);
    const [basisKey, setBasisKey] = React.useState<string | null>(null);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [admissionPending, setAdmissionPending] = React.useState<TeamAdmissionModeV1 | null>(null);
    const [admissionNotice, setAdmissionNotice] = React.useState<string | null>(null);
    // The shell owns the shared-approval artifact and releases it on execution,
    // rejection and failure, so this is the only truthful source of "still
    // waiting". Latching it here would survive a terminal decision.
    const approvalPending = context.approvalPending;
    // Closes the duplicate-submit window that opens between the press and the
    // render that would disable the control; no debounce is involved.
    const operationInFlightRef = React.useRef<symbol | null>(null);
    // `null` is a valid compare-and-set basis (Home inheritance), so absence
    // needs its own sentinel.
    const basisRef = React.useRef<TeamAuthenticationPolicyComparisonBasisV1 | undefined>(undefined);

    React.useEffect(() => () => {
        operationInFlightRef.current = null;
    }, []);

    // Once the Home publishes what the administrator asked for, the draft has
    // served its purpose and the projection becomes the only truth again.
    const draftKey = draft === null ? null : JSON.stringify(draft);
    React.useEffect(() => {
        if (draftKey === null) return;
        const committedKey = repairRequired
            ? null
            : JSON.stringify(policy.authenticationPolicy ?? { v: 1, mode: 'inherit' });
        if (committedKey !== draftKey) return;
        setDraft(null);
        setBasisKey(null);
        basisRef.current = undefined;
        setError(null);
    }, [draftKey, policy.authenticationPolicy, repairRequired]);

    const committedMode: 'inherit' | 'restricted' | null = repairRequired
        ? null
        : policy.authenticationPolicy === null ? 'inherit' : 'restricted';
    const selected: TeamAuthenticationPolicyV1 | null = draft
        ?? (repairRequired
            ? null
            : policy.authenticationPolicy ?? { v: 1, mode: 'inherit' });
    const selectedMode = selected?.mode ?? null;
    const accepted: readonly TeamAcceptedAuthenticationV1[] = selected?.mode === 'restricted'
        ? selected.accepted
        : [];
    const acceptedKeys = new Set(accepted.map(acceptedKey));
    // References the stored policy already carries that this surface cannot
    // author. They are displayed and preserved rather than silently dropped.
    const retainedHomeMethods = accepted.filter(
        (reference): reference is Extract<TeamAcceptedAuthenticationV1, { kind: 'home_method' }> =>
            reference.kind === 'home_method',
    );

    const editable = context.team.capabilities.manageAuthentication
        && context.canMutate
        && !saving
        && admissionPending === null;
    const admissionEditable = editable
        && connectionsCurrent
        && admissionModeApplicability !== null;
    const conflicted = basisKey !== null && basisKey !== observedBasisKey;

    const beginDraft = React.useCallback((next: TeamAuthenticationPolicyV1) => {
        if (basisRef.current === undefined) {
            basisRef.current = observedBasis;
            setBasisKey(observedBasisKey);
        }
        setDraft(next);
        setError(null);
    }, [observedBasis, observedBasisKey]);

    // Abandoning the edit is a local decision only: the Home is never told, and
    // the authoritative projection becomes the whole truth again.
    const cancelDraft = React.useCallback(() => {
        basisRef.current = undefined;
        setBasisKey(null);
        setDraft(null);
        setError(null);
    }, []);

    const acknowledgeCurrentBasis = React.useCallback(() => {
        basisRef.current = observedBasis;
        setBasisKey(observedBasisKey);
        setError(null);
    }, [observedBasis, observedBasisKey]);

    const chooseMode = React.useCallback((mode: 'inherit' | 'restricted') => {
        if (mode === 'inherit') { beginDraft({ v: 1, mode: 'inherit' }); return; }
        beginDraft({
            v: 1,
            mode: 'restricted',
            accepted: accepted.length > 0
                ? [...accepted]
                : connections
                    .filter((connection) => connection.enabled)
                    .map((connection) => ({ kind: 'team_connection' as const, connectionId: connection.id })),
        });
    }, [accepted, beginDraft, connections]);

    const toggleConnection = React.useCallback((connectionId: string) => {
        const key = `team_connection:${connectionId}`;
        const next = acceptedKeys.has(key)
            ? accepted.filter((reference) => acceptedKey(reference) !== key)
            : [...accepted, { kind: 'team_connection' as const, connectionId }];
        beginDraft({ v: 1, mode: 'restricted', accepted: next });
    }, [accepted, acceptedKeys, beginDraft]);

    const submitPolicy = React.useCallback(async () => {
        const basis = basisRef.current;
        if (operationInFlightRef.current !== null || draft === null || basis === undefined) return;
        if (draft.mode === 'restricted' && draft.accepted.length === 0) return;
        const operationIdentity = Symbol('team-authentication-policy');
        operationInFlightRef.current = operationIdentity;
        setSaving(true);
        setError(null);
        try {
            const outcome = await setTeamPolicy({
                scope: context.scope,
                address: context.address,
                previousAuthenticationPolicy: basis,
                authenticationPolicy: draft,
            });
            if (operationInFlightRef.current !== operationIdentity) return;
            if (outcome.kind === 'succeeded') return;
            if (outcome.failure.code === 'team_authentication_policy_conflict') {
                // The Home moved under the edit. Keep the intent, re-read, and
                // require one deliberate acknowledgement of the new basis.
                setBasisKey(null);
                basisRef.current = undefined;
                setError(t('teams.authentication.policy.conflictBody'));
                context.refresh();
                return;
            }
            setError(policyFailureLabel(outcome.failure) ?? teamMutationFailureLabel(outcome.failure));
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) {
                // The shell now renders and owns the pending state.
                context.requestApproval(cause.artifactId);
                return;
            }
            setError(t('teams.errors.generic'));
        } finally {
            if (operationInFlightRef.current === operationIdentity) {
                operationInFlightRef.current = null;
                setSaving(false);
            }
        }
    }, [context, draft]);

    const chooseAdmission = React.useCallback(async (mode: TeamAdmissionModeV1) => {
        if (
            operationInFlightRef.current !== null
            || mode === policy.admissionMode
            || !admissionEditable
            || admissionModeApplicability?.modes[mode].status !== 'available'
        ) return;
        const operationIdentity = Symbol('team-admission-mode');
        operationInFlightRef.current = operationIdentity;
        setAdmissionPending(mode);
        setAdmissionNotice(null);
        try {
            const outcome = await setTeamPolicy({
                scope: context.scope,
                address: context.address,
                admissionMode: mode,
            });
            if (operationInFlightRef.current !== operationIdentity) return;
            if (outcome.kind === 'succeeded') return;
            // The Home refused. The selection below still shows the mode the
            // Home holds, so nothing claims a change that did not happen.
            setAdmissionNotice(
                outcome.failure.code === 'team_authentication_policy_unavailable'
                    ? t('teams.authentication.policy.admissionUnavailable')
                    : teamMutationFailureLabel(outcome.failure),
            );
        } catch (cause) {
            if (isTeamActionApprovalPendingError(cause)) {
                // No local notice: the shared approval is the shell's fact, and
                // a rejection there must not leave this section saying "waiting".
                context.requestApproval(cause.artifactId);
                return;
            }
            setAdmissionNotice(t('teams.errors.generic'));
        } finally {
            if (operationInFlightRef.current === operationIdentity) {
                operationInFlightRef.current = null;
                setAdmissionPending(null);
            }
        }
    }, [admissionEditable, admissionModeApplicability, context, policy.admissionMode]);

    const restrictedWithoutReferences = selectedMode === 'restricted' && accepted.length === 0;
    const canApply = editable
        && draft !== null
        && !conflicted
        && basisKey !== null
        && !restrictedWithoutReferences;

    // A mode the Home cannot enforce is explained on its own row, beside the
    // choice it describes. Repeating that same sentence here would only crowd
    // out the help text that says what admission means in the first place.
    const admissionFooter = admissionNotice
        ?? (approvalPending ? t('teams.authentication.policy.approvalPending') : undefined)
        ?? t('teams.authentication.policy.admissionHelp');

    return (
        <>
            <ItemGroup
                title={t('teams.authentication.policy.admissionSection')}
                footer={admissionFooter}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('teams.authentication.policy.admissionSection')}
            >
                {ADMISSION_MODES.map((mode) => {
                    const availability = admissionModeApplicability?.modes[mode] ?? null;
                    const available = availability?.status === 'available';
                    return <Item
                        key={mode}
                        testID={`team-admission-mode:${mode}`}
                        title={admissionModeLabel(mode)}
                        accessibilityRole="radio"
                        webRole="radio"
                        selected={policy.admissionMode === mode}
                        accessibilityChecked={policy.admissionMode === mode}
                        loading={admissionPending === mode}
                        subtitle={availability?.status === 'unavailable'
                            ? admissionModeUnavailableLabel(availability)
                            : undefined}
                        disabled={!admissionEditable || !available || policy.admissionMode === mode}
                        onPress={admissionEditable && available && policy.admissionMode !== mode
                            ? () => { void chooseAdmission(mode); }
                            : undefined}
                        showChevron={false}
                    />;
                })}
                {admissionNotice ? (
                    <Item
                        testID="team-admission-notice"
                        title={admissionNotice}
                        accessibilityLiveRegion="assertive"
                        showChevron={false}
                    />
                ) : approvalPending ? (
                    <Item
                        testID="team-admission-approval-pending"
                        title={t('teams.authentication.policy.approvalPending')}
                        accessibilityLiveRegion="polite"
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>

            <ItemGroup
                title={t('teams.authentication.policy.acceptedSection')}
                footer={error ?? t('teams.authentication.policy.acceptedHelp')}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('teams.authentication.policy.acceptedSection')}
            >
                {repairRequired && committedMode === null ? (
                    <Item
                        testID="team-authentication-policy-repair"
                        title={t('teams.authentication.policy.repairRequired')}
                        subtitle={t('teams.authentication.policy.repairRequiredHelp')}
                        accessibilityLiveRegion="assertive"
                        showChevron={false}
                    />
                ) : null}
                <Item
                    testID="team-authentication-policy-mode:inherit"
                    title={t('teams.authentication.policy.acceptedInherit')}
                    accessibilityRole="radio"
                    webRole="radio"
                    selected={selectedMode === 'inherit'}
                    accessibilityChecked={selectedMode === 'inherit'}
                    disabled={!editable}
                    onPress={editable ? () => chooseMode('inherit') : undefined}
                    showChevron={false}
                />
                <Item
                    testID="team-authentication-policy-mode:restricted"
                    title={t('teams.authentication.policy.acceptedRestricted')}
                    accessibilityRole="radio"
                    webRole="radio"
                    selected={selectedMode === 'restricted'}
                    accessibilityChecked={selectedMode === 'restricted'}
                    disabled={!editable || !connectionsCurrent}
                    onPress={editable && connectionsCurrent ? () => chooseMode('restricted') : undefined}
                    showChevron={false}
                />
            </ItemGroup>

            {selectedMode === 'restricted' ? (
                <ItemGroup
                    title={t('teams.authentication.policy.connectionsSection')}
                    footer={restrictedWithoutReferences
                        ? t('teams.authentication.policy.connectionsEmpty')
                        : t('teams.authentication.policy.homeMethodsUnavailable')}
                >
                    {connections.map((connection) => {
                        const checked = acceptedKeys.has(`team_connection:${connection.id}`);
                        // Two connections may share a provider name. Naming only
                        // the provider would ask for a blind choice, so the exact
                        // connection is spelled out whenever it is ambiguous.
                        const ambiguous = connections.some((other) => other.id !== connection.id
                            && other.provider.displayName === connection.provider.displayName);
                        const owner = t('teams.authentication.policy.connectionOwnerTeam');
                        return (
                            <Item
                                key={connection.id}
                                testID={`team-authentication-policy-connection:${connection.id}`}
                                title={connection.provider.displayName}
                                subtitle={ambiguous
                                    ? `${owner} · ${identityConnectionDiscriminator(connection)}`
                                    : owner}
                                accessibilityLabel={ambiguous
                                    ? `${connection.provider.displayName}, ${owner}, ${identityConnectionDiscriminator(connection)}`
                                    : `${connection.provider.displayName}, ${owner}`}
                                accessibilityRole="checkbox"
                                webRole="checkbox"
                                selected={checked}
                                accessibilityChecked={checked}
                                disabled={!editable || (!connection.enabled && !checked)}
                                onPress={editable && (connection.enabled || checked)
                                    ? () => toggleConnection(connection.id)
                                    : undefined}
                                showChevron={false}
                            />
                        );
                    })}
                    {retainedHomeMethods.map((reference) => (
                        <Item
                            key={acceptedKey(reference)}
                            testID={`team-authentication-policy-home-method:${reference.methodId}`}
                            mode="info"
                            title={reference.methodId}
                            subtitle={`${t('teams.authentication.policy.connectionOwnerHome')} · ${t('teams.authentication.policy.homeMethodRetained')}`}
                            showChevron={false}
                        />
                    ))}
                    {connections.length === 0 ? (
                        <Item
                            testID="team-authentication-policy-connections-empty"
                            mode="info"
                            title={t('teams.authentication.policy.connectionsEmpty')}
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>
            ) : null}

            {draft !== null ? (
                <ItemGroup>
                    {conflicted ? (
                        <Item
                            testID="team-authentication-policy-conflict"
                            title={t('teams.errors.conflict')}
                            subtitle={t('teams.authentication.policy.conflictBody')}
                            detail={t('common.continue')}
                            accessibilityLiveRegion="assertive"
                            disabled={saving}
                            onPress={acknowledgeCurrentBasis}
                            showChevron={false}
                        />
                    ) : null}
                    {basisKey === null ? (
                        <Item
                            testID="team-authentication-policy-rebase"
                            title={t('teams.errors.conflict')}
                            subtitle={t('teams.authentication.policy.conflictBody')}
                            detail={t('common.continue')}
                            accessibilityLiveRegion="assertive"
                            disabled={saving}
                            onPress={acknowledgeCurrentBasis}
                            showChevron={false}
                        />
                    ) : null}
                    <Item
                        testID="team-authentication-policy-save"
                        title={t('common.save')}
                        loading={saving}
                        disabled={!canApply}
                        onPress={canApply ? () => { void submitPolicy(); } : undefined}
                        showChevron={false}
                    />
                    <Item
                        testID="team-authentication-policy-cancel"
                        title={t('common.cancel')}
                        disabled={saving}
                        onPress={saving ? undefined : cancelDraft}
                        showChevron={false}
                    />
                    {approvalPending ? (
                        <Item
                            testID="team-authentication-policy-approval-pending"
                            title={t('teams.authentication.policy.approvalPending')}
                            accessibilityLiveRegion="polite"
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>
            ) : null}
        </>
    );
});
