import * as React from 'react';
import { useRouter } from 'expo-router';
import type { HomeAccountRowV1, HomeRoleV1 } from '@happier-dev/protocol/home/governance';
import { useUnistyles } from 'react-native-unistyles';

import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { useHomeAccountRoster } from '@/hooks/home/useHomeAccountRoster';
import { Modal } from '@/modal';
import { formatAccountDisplayName } from '@/sync/domains/account/formatAccountDisplayName';
import {
    resolveHomeAccountAdministrationActions,
    type HomeAccountActionAvailability,
} from '@/sync/domains/home/governance/homeAccountAdministration';
import {
    deleteHomeAccount,
    disableHomeAccount,
    enableHomeAccount,
    setHomeAccountRole,
    type HomeGovernanceMutationOutcome,
} from '@/sync/ops/home/homeGovernanceOperations';
import { t } from '@/text';

import { HomeAdministrationSection } from './HomeAdministrationSection';
import type { HomeAdministrationContext } from './homeAdministrationContext';
import { HomeAccountStatusPill } from './HomeAccountStatusPill';
import {
    homeAccountStatusDetail,
    homeAccountStatusLabel,
    homeActionUnavailableReasonLabel,
    homeGovernanceFailureNotice,
    homeRoleDescription,
    homeRoleLabel,
} from './homeGovernanceLabels';

/** The subtitle an entitled-but-blocked action carries instead of vanishing. */
function unavailableSubtitle(availability: HomeAccountActionAvailability): string | undefined {
    return availability.state === 'unavailable'
        ? homeActionUnavailableReasonLabel(availability.reason)
        : undefined;
}

const AccountAdministration = React.memo(function AccountAdministration(props: Readonly<{
    context: HomeAdministrationContext;
    row: HomeAccountRowV1;
    onChanged: () => void;
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const { context, row, onChanged } = props;
    type PendingAction = Readonly<
        | { kind: 'role'; role: HomeRoleV1 }
        | { kind: 'disable' | 'enable' | 'delete' }
    >;
    const [pendingAction, setPendingAction] = React.useState<PendingAction | null>(null);
    const operationInFlightRef = React.useRef(false);
    const busy = pendingAction !== null;

    const actions = React.useMemo(() => resolveHomeAccountAdministrationActions({
        target: row,
        mutationsAvailable: context.mutationsAvailable,
    }), [context.mutationsAvailable, row]);

    const name = formatAccountDisplayName(row.profile) ?? row.accountId;
    const authenticationMethodLabels = React.useMemo(() => {
        const labelById = new Map(context.projection.authenticationOptions.methods.flatMap((method) => {
            const label = method.displayName?.trim();
            return label ? [[method.id, label] as const] : [];
        }));
        return [...new Set(row.authentication.usableMethodIds.flatMap((methodId) => {
            const label = labelById.get(methodId);
            return label ? [label] : [];
        }))];
    }, [context.projection.authenticationOptions.methods, row.authentication.usableMethodIds]);

    const run = React.useCallback(async (
        action: PendingAction,
        operation: () => Promise<HomeGovernanceMutationOutcome>,
    ): Promise<HomeGovernanceMutationOutcome | null> => {
        // The visible disabled state follows on the next render; this ref also
        // closes the same-frame double-activation window on fast pointer/touch.
        if (operationInFlightRef.current) return null;
        operationInFlightRef.current = true;
        setPendingAction(action);
        try {
            const outcome = await operation();
            if (outcome.kind === 'succeeded') {
                const actionLabel = action.kind === 'role'
                    ? `${t('homeGovernance.changeRole')}: ${homeRoleLabel(action.role)}`
                    : t(action.kind === 'disable'
                        ? 'homeGovernance.disable'
                        : action.kind === 'enable'
                            ? 'homeGovernance.enable'
                            : 'homeGovernance.deleteAccount');
                announceAccessibilityMessage(`${actionLabel}. ${t('common.success')}`);
                onChanged();
                return outcome;
            }
            if (outcome.kind === 'incomplete') {
                // Access is gone but cleanup is not finished. This is reported as
                // a failure with a retry, never as a completed deletion.
                await Modal.alertAsync(
                    t('homeGovernance.deleteIncompleteTitle'),
                    t('homeGovernance.deleteIncompleteBody'),
                );
                onChanged();
                return outcome;
            }
            if (outcome.kind === 'approval_pending') {
                context.requestApproval?.(outcome.artifactId);
                return outcome;
            }
            const notice = homeGovernanceFailureNotice(outcome.failure);
            await Modal.alertAsync(notice.title, notice.body);
            // The refusal is itself evidence this Home moved under us.
            context.refresh();
            onChanged();
            return outcome;
        } finally {
            operationInFlightRef.current = false;
            setPendingAction(null);
        }
    }, [context, onChanged]);

    const changeRole = React.useCallback(async (nextRole: HomeRoleV1) => {
        if (nextRole === row.homeRole) return;
        await run({ kind: 'role', role: nextRole }, () => setHomeAccountRole({
            scope: context.scope,
            accountId: row.accountId,
            homeRole: nextRole,
        }));
    }, [run, context.scope, row.accountId, row.homeRole]);

    const confirmDisable = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            t('homeGovernance.disableTitle', { account: name }),
            t('homeGovernance.disableBody'),
            { confirmText: t('homeGovernance.disableConfirm'), destructive: true },
        );
        if (!confirmed) return;
        await run({ kind: 'disable' }, () => disableHomeAccount({ scope: context.scope, accountId: row.accountId }));
    }, [run, context.scope, row.accountId, name]);

    const confirmEnable = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            t('homeGovernance.enableTitle', { account: name }),
            t('homeGovernance.enableBody'),
            { confirmText: t('homeGovernance.enableConfirm') },
        );
        if (!confirmed) return;
        await run({ kind: 'enable' }, () => enableHomeAccount({ scope: context.scope, accountId: row.accountId }));
    }, [run, context.scope, row.accountId, name]);

    const confirmDelete = React.useCallback(async () => {
        const confirmed = await Modal.confirm(
            t('homeGovernance.deleteTitle', { account: name }),
            t('homeGovernance.deleteBody', { home: context.homeName }),
            { confirmText: t('homeGovernance.deleteConfirm'), destructive: true },
        );
        if (!confirmed) return;
        const outcome = await run({ kind: 'delete' }, () => deleteHomeAccount({
            scope: context.scope,
            accountId: row.accountId,
        }));
        // Only a finished deletion removes the row this screen is about.
        if (outcome?.kind === 'succeeded') router.back();
    }, [run, context.scope, context.homeName, row.accountId, name, router]);

    // A Retired Account whose deletion did not finish is retried with the same
    // authorized operation, so the destructive verb stays honest.
    const deleteTitle = row.status === 'disabled'
        ? t('homeGovernance.retryDeletion')
        : t('homeGovernance.deleteAccount');

    return (
        <>
            <ItemGroup title={name}>
                <Item
                    testID="home-account-status"
                    title={homeAccountStatusLabel(row.status)}
                    subtitle={homeAccountStatusDetail(row.status) ?? undefined}
                    rightElement={<HomeAccountStatusPill row={row} testID="home-account-status-pill" />}
                    showChevron={false}
                />
                <Item
                    testID="home-account-role"
                    title={t('homeGovernance.roleSheetTitle')}
                    detail={homeRoleLabel(row.homeRole)}
                    subtitle={unavailableSubtitle(actions.setRole)}
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup title={t('homeGovernance.signInMethods')}>
                <Item
                    testID="home-account-sign-in-email"
                    title={t('settingsAccount.nativePassword.signInEmail')}
                    detail={row.authentication.signInEmail
                        ?? t('settingsAccount.nativePassword.signInEmailNotSet')}
                    showChevron={false}
                />
                <Item
                    testID="home-account-sign-in-methods"
                    title={t('homeGovernance.signInMethods')}
                    detail={authenticationMethodLabels.length > 0
                        ? authenticationMethodLabels.join(', ')
                        : t('settingsAccount.nativePassword.notEligible')}
                    showChevron={false}
                />
            </ItemGroup>

            {actions.setRole.state === 'available' ? (
                <ItemGroup
                    title={t('homeGovernance.changeRole')}
                    accessibilityRole="radiogroup"
                    accessibilityLabel={t('homeGovernance.changeRole')}
                >
                    {actions.assignableRoles.map((role) => {
                        const roleAvailable = row.mutationCapabilities.setRole[role].status === 'available'
                            && context.mutationsAvailable;
                        return (
                            <Item
                                key={role}
                                testID={`home-account-role:${role}`}
                                title={homeRoleLabel(role)}
                                subtitle={homeRoleDescription(role)}
                                accessibilityRole="radio"
                                webRole="radio"
                                selected={row.homeRole === role}
                                loading={pendingAction?.kind === 'role' && pendingAction.role === role}
                                disabled={busy || !roleAvailable}
                                onPress={roleAvailable && !busy ? () => { void changeRole(role); } : undefined}
                                showChevron={false}
                            />
                        );
                    })}
                </ItemGroup>
            ) : null}

            {actions.disable.state !== 'hidden'
                || actions.enable.state !== 'hidden'
                || actions.delete.state !== 'hidden' ? (
                <ItemGroup title={t('homeGovernance.title')}>
                    {actions.enable.state !== 'hidden' ? (
                        <Item
                            testID="home-account-enable"
                            title={t('homeGovernance.enable')}
                            subtitle={unavailableSubtitle(actions.enable)}
                            disabled={actions.enable.state !== 'available' || busy}
                            loading={pendingAction?.kind === 'enable'}
                            onPress={actions.enable.state === 'available' && !busy
                                ? () => { void confirmEnable(); }
                                : undefined}
                            showChevron={false}
                        />
                    ) : null}
                    {actions.disable.state !== 'hidden' ? (
                        <Item
                            testID="home-account-disable"
                            title={t('homeGovernance.disable')}
                            subtitle={unavailableSubtitle(actions.disable)}
                            icon={<Icon name="warning" size={29} color={theme.colors.state.danger.foreground} />}
                            destructive
                            disabled={actions.disable.state !== 'available' || busy}
                            loading={pendingAction?.kind === 'disable'}
                            onPress={actions.disable.state === 'available' && !busy
                                ? () => { void confirmDisable(); }
                                : undefined}
                            showChevron={false}
                        />
                    ) : null}
                    {actions.delete.state !== 'hidden' ? (
                        <Item
                            testID="home-account-delete"
                            title={deleteTitle}
                            subtitle={unavailableSubtitle(actions.delete)}
                            icon={<Icon name="trash" size={29} color={theme.colors.state.danger.foreground} />}
                            destructive
                            disabled={actions.delete.state !== 'available' || busy}
                            loading={pendingAction?.kind === 'delete'}
                            onPress={actions.delete.state === 'available' && !busy
                                ? () => { void confirmDelete(); }
                                : undefined}
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>
            ) : null}
        </>
    );
});

const AccountLookup = React.memo(function AccountLookup(props: Readonly<{
    context: HomeAdministrationContext;
    accountId: string;
}>) {
    const { context, accountId } = props;
    const canList = context.projection.capabilities.manageAccounts;
    const roster = useHomeAccountRoster(context.scope, canList);
    const row = roster.rows.find((candidate) => candidate.accountId === accountId) ?? null;

    // Opened directly rather than from the list: keep reading pages until this
    // Account is found or the Home runs out of them.
    React.useEffect(() => {
        if (row || !roster.hasMore) return;
        // Only a successful page proves where the next page begins. A failed
        // read remains visible for an explicit retry instead of becoming an
        // automatic retry loop or a false not-found answer.
        if (roster.status !== 'ready') return;
        roster.loadMore();
    }, [row, roster]);

    if (row) {
        return <AccountAdministration context={context} row={row} onChanged={roster.reload} />;
    }

    if (roster.error) {
        const unsupported = roster.error.kind === 'unsupported';
        return (
            <ItemGroup
                title={unsupported
                    ? t('homeGovernance.rosterUnavailableTitle')
                    : t('homeGovernance.unavailableTitle')}
                footer={unsupported
                    ? t('homeGovernance.rosterUnavailableBody')
                    : t('homeGovernance.unavailableBody')}
            >
                <Item
                    testID={unsupported
                        ? 'home-account-roster-unsupported'
                        : 'home-account-roster-error'}
                    title={unsupported
                        ? t('homeGovernance.rosterUnavailableTitle')
                        : t('homeGovernance.unavailableTitle')}
                    showChevron={false}
                />
                {roster.error.retryable ? (
                    <Item
                        testID="home-account-roster-retry"
                        title={t('homeGovernance.retry')}
                        onPress={roster.reload}
                        showChevron={false}
                    />
                ) : null}
            </ItemGroup>
        );
    }

    if (roster.status === 'loading' || roster.status === 'loading_more') {
        return (
            <ItemGroup>
                <Item testID="home-account-loading" title={t('homeGovernance.loading')} loading showChevron={false} />
            </ItemGroup>
        );
    }

    if (roster.status === 'ready' && !roster.hasMore) return (
        <ItemGroup footer={t('homeGovernance.accountUnavailableBody')}>
            <Item
                testID="home-account-unavailable"
                title={t('homeGovernance.errorAccountNotFound')}
                showChevron={false}
            />
        </ItemGroup>
    );

    return (
        <ItemGroup>
            <Item testID="home-account-loading" title={t('homeGovernance.loading')} loading showChevron={false} />
        </ItemGroup>
    );
});

export const HomeAdministrationAccountScreen = React.memo(function HomeAdministrationAccountScreen(
    props: Readonly<{ serverId: string; accountId: string }>,
) {
    return (
        <HomeAdministrationSection serverId={props.serverId} title={t('homeGovernance.people')}>
            {/* The shell discards this section when the Home/Account scope
                changes; this key covers the other identity dimension, the exact
                Account being administered. */}
            {(context) => (
                <AccountLookup
                    key={props.accountId}
                    context={context}
                    accountId={props.accountId}
                />
            )}
        </HomeAdministrationSection>
    );
});
