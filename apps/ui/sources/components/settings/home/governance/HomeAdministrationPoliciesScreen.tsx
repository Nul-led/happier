import * as React from 'react';
import { type TeamCreationPolicyV1 } from '@happier-dev/protocol/home/governance';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SettingAnchor, SettingRow, SettingSection } from '@/components/settings/shell/SettingRow';
import { Switch } from '@/components/ui/forms/Switch';
import { Modal } from '@/modal';
import type { HomeDomainFailure } from '@/sync/api/home/homeServerActionTransport';
import {
    setHomeTeamCreationPolicy,
    setHomeTeamsVisibleToMembers,
    type HomeGovernanceAcknowledgedOutcome,
} from '@/sync/ops/home/homeGovernanceOperations';
import { t } from '@/text';

import { HomeAdministrationSection } from './HomeAdministrationSection';
import { SignInPolicyEditor } from './HomeSignInPolicySections';
import { HOME_AUTHENTICATION_SETTINGS } from './homeAuthenticationSettings';
import { HOME_TEAMS_POLICY_SETTINGS } from './homeTeamsPolicySettings';
import type { HomeAdministrationContext } from './homeAdministrationContext';
import {
    homeGovernanceFailureNotice,
    teamCreationPolicyDescription,
    teamCreationPolicyLabel,
} from './homeGovernanceLabels';

const TEAM_CREATION_CHOICES: readonly TeamCreationPolicyV1[] = ['self_service', 'managed_only', 'disabled'];

/**
 * One field of the Home's single revision-guarded policy document, edited in place.
 *
 * The selection is never shown as applied before the Home confirms it. On a
 * revision conflict the administrator's choice is deliberately kept on screen:
 * they still want it, they simply need to see what changed underneath and apply
 * it again.
 */
function useHomePolicyFieldEditor<TValue>(input: Readonly<{
    context: HomeAdministrationContext;
    committed: TValue;
    save: (params: Readonly<{ expectedRevision: number; value: TValue }>) => Promise<HomeGovernanceAcknowledgedOutcome>;
}>) {
    const { context, committed, save } = input;
    const { projection, scope } = context;

    const [pending, setPending] = React.useState<TValue | null>(null);
    // The Home's own refusal, kept so the retry row can say what actually
    // happened instead of one sentence that also has to cover a lost answer.
    const [saveFailure, setSaveFailure] = React.useState<HomeDomainFailure | null>(null);
    const operationInFlightRef = React.useRef<symbol | null>(null);
    // A conflicted choice outlives the failed save so it can be applied again.
    const [draft, setDraft] = React.useState<TValue | null>(null);

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

    const selected = draft ?? committed;

    const choose = React.useCallback(async (next: TValue) => {
        if (operationInFlightRef.current !== null || (next === selected && draft === null)) return;
        const operationIdentity = Symbol('home-policy-field');
        operationInFlightRef.current = operationIdentity;
        setDraft(next);
        setSaveFailure(null);
        setPending(next);
        try {
            const outcome = await save({ expectedRevision: projection.policy.revision, value: next });
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
    }, [selected, draft, save, projection.policy.revision, context]);

    // The shell owns the shared-approval artifact and releases it on execution,
    // rejection and failure. Latching it here would keep saying "waiting" after
    // a terminal decision the shell has already acted on.
    return { selected, pending, saveFailure, approvalPending: context.approvalPending, choose };
}

/** A policy save's refusal and its retry, then any pending shared approval, under the rows. */
const HomePolicyFieldStatusRows = React.memo(function HomePolicyFieldStatusRows(props: Readonly<{
    testIDPrefix: string;
    saveFailure: HomeDomainFailure | null;
    approvalPending: boolean | undefined;
    retryDisabled: boolean;
    onRetry: (() => void) | undefined;
}>) {
    return (
        <>
            {props.saveFailure ? (
                <Item
                    testID={`${props.testIDPrefix}-retry`}
                    title={t('homeGovernance.retry')}
                    subtitle={homeGovernanceFailureNotice(props.saveFailure).body}
                    disabled={props.retryDisabled}
                    onPress={props.onRetry}
                    showChevron={false}
                />
            ) : null}
            {props.approvalPending ? (
                <Item
                    testID={`${props.testIDPrefix}-approval-pending`}
                    title={t('connect.waitingForApproval')}
                    showChevron={false}
                />
            ) : null}
        </>
    );
});

/** Team creation: who may create a Team on this Home. */
export const TeamCreationPolicyEditor = React.memo(function TeamCreationPolicyEditor(
    props: Readonly<{ context: HomeAdministrationContext }>,
) {
    const { context } = props;
    const { projection, scope, mutationsAvailable } = context;
    const save = React.useCallback(
        (params: Readonly<{ expectedRevision: number; value: TeamCreationPolicyV1 }>) => setHomeTeamCreationPolicy({
            scope,
            expectedRevision: params.expectedRevision,
            teamCreationPolicy: params.value,
        }),
        [scope],
    );
    const editor = useHomePolicyFieldEditor({ context, committed: projection.policy.teamCreationPolicy, save });
    const editable = projection.capabilities.manageTeamCreationPolicy;
    const { selected, pending, choose } = editor;

    return (
        <SettingAnchor setting={HOME_TEAMS_POLICY_SETTINGS.settings.teamCreationPolicy}><ItemGroup
            title={t('homeGovernance.teamCreation')}
            // A Home that is not answering is said once, by the page banner, not on every section.
            description={editable ? undefined : t('homeGovernance.policyReadOnly')}
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
            <HomePolicyFieldStatusRows
                testIDPrefix="home-policy-team-creation"
                saveFailure={editor.saveFailure}
                approvalPending={editor.approvalPending}
                retryDisabled={!editable || !mutationsAvailable || pending !== null}
                onRetry={editable && mutationsAvailable && pending === null ? () => { void choose(selected); } : undefined}
            />
        </ItemGroup></SettingAnchor>
    );
});

/**
 * Whether members who are in no Team still see Teams. Members of a Team and
 * administrators always do; the Home decides, never a client.
 */
export const TeamsVisibilityPolicyEditor = React.memo(function TeamsVisibilityPolicyEditor(
    props: Readonly<{ context: HomeAdministrationContext }>,
) {
    const { context } = props;
    const { projection, scope, mutationsAvailable } = context;
    const save = React.useCallback(
        (params: Readonly<{ expectedRevision: number; value: boolean }>) => setHomeTeamsVisibleToMembers({
            scope,
            expectedRevision: params.expectedRevision,
            teamsVisibleToMembers: params.value,
        }),
        [scope],
    );
    // A Home that predates the policy reports nothing: it shows Teams to everyone and cannot store
    // this choice, so the row is not offered there.
    const reported = projection.policy.teamsVisibleToMembers;
    const editor = useHomePolicyFieldEditor({ context, committed: reported ?? true, save });
    const editable = projection.capabilities.manageTeamCreationPolicy;
    const { selected, pending, choose } = editor;
    const interactive = editable && mutationsAvailable && pending === null;
    if (reported === undefined) return null;

    return (
        <ItemGroup
            title={t('homeGovernance.teamsVisibility')}
            // A Home that is not answering is said once, by the page banner, not on every section.
            description={editable ? undefined : t('homeGovernance.policyReadOnly')}
        >
            <SettingRow
                setting={HOME_TEAMS_POLICY_SETTINGS.settings.teamsVisibleToMembers}
                testID="home-policy-teams-visible-to-members"
                loading={pending !== null}
                disabled={!interactive}
                onPress={interactive ? () => { void choose(!selected); } : undefined}
                rightElement={(
                    <Switch
                        testID="home-policy-teams-visible-to-members-switch"
                        value={selected}
                        disabled={!interactive}
                        onValueChange={(next) => { void choose(next); }}
                    />
                )}
                showChevron={false}
            />
            <HomePolicyFieldStatusRows
                testIDPrefix="home-policy-teams-visible-to-members"
                saveFailure={editor.saveFailure}
                approvalPending={editor.approvalPending}
                retryDisabled={!interactive}
                onRetry={interactive ? () => { void choose(selected); } : undefined}
            />
        </ItemGroup>
    );
});

/**
 * How people sign in and join this Home: methods, Account modes, the recommended mode and admission.
 * Identity providers, GitHub Apps, private endpoints and Team sign-in rules live on the Sign-in
 * providers page; this page only turns a provider's sign-in method on or off.
 */
export const HomeAuthenticationPolicySections = React.memo(function HomeAuthenticationPolicySections(
    props: Readonly<{ context: HomeAdministrationContext }>,
) {
    return <SignInPolicyEditor context={props.context} />;
});

export const HomeAdministrationPoliciesScreen = React.memo(function HomeAdministrationPoliciesScreen(
    props: Readonly<{ serverId: string }>,
) {
    return (
        <HomeAdministrationSection serverId={props.serverId} title={t('homeGovernance.policies')} description={t('homeGovernance.pages.policies')}>
            {(context) => (
                <>
                    {/* Plan §3.10 order: sign-in methods and admission, encryption, then Teams. */}
                    {/* Owners edit sign-in and encryption; admins read them (plan I4), so the page stays one page. */}
                    <SettingSection section={HOME_AUTHENTICATION_SETTINGS.sectionRefs.authentication}>
                        <HomeAuthenticationPolicySections context={context} />
                    </SettingSection>
                    <TeamCreationPolicyEditor context={context} />
                    <TeamsVisibilityPolicyEditor context={context} />
                </>
            )}
        </HomeAdministrationSection>
    );
});
