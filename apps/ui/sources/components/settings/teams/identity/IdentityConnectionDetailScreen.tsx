import * as React from 'react';
import { useRouter } from 'expo-router';
import { AppState } from 'react-native';
import type { IdentityConnectionTestDiagnosticsV1 } from '@happier-dev/protocol';

import { runTeamIdentityProviderTestReturn } from '@/components/settings/home/identity/identityProviderTestReturn';
import { useManagedIdentityProviders } from '@/components/settings/home/identity/useManagedIdentityProviders';
import { IdentityTestDiagnosticsGroup } from '@/components/settings/identity/IdentityTestDiagnosticsGroup';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { TextInput } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import { identityAdministrationFailure, identityAdministrationFailureMessage, identityAdministrationFailureRecoveryLabel } from '@/components/settings/identity/identityAdministrationFailure';
import { announceAccessibilityMessage } from '@/components/ui/accessibility/announceAccessibilityMessage';
import { t } from '@/text';
import { openExternalUrl } from '@/utils/url/openExternalUrl';
import type { ActionApprovalRegistration } from '@/components/approvals/actionApprovalContinuation';

import { TeamSection } from '../TeamSection';
import { teamDirectoryPath, teamIdentityConnectionPath, teamIdentityConnectionProviderEditPath } from '../teamsRoutes';
import {
    createIdentityAdministrationClient,
    type IdentityAdministrationActionResult,
    type TeamIdentityActionOutput,
} from './identityAdministrationClient';
import {
    identityConnectionMode,
    identityConnectionTestStatus,
    identityProviderKindLabel,
    workosConnectionStatusLabel,
    workosConnectionStrategyLabel,
} from './identityAdministrationPresentation';
import { connectionStateLabel } from './TeamAuthenticationSettingsScreen';
import { useIdentityAdministration } from './useIdentityAdministration';
import { createWorkosPortalReturnController } from './workosPortalReturn';
import { IdentityConnectionGroupMappings } from './IdentityConnectionGroupMappings';
import {
    connectionSettingsFromDraft,
    type OidcConnectionSettingsDraft,
} from './teamIdentitySetup';
import {
    revisionedSettingsDraftTransition,
    type RevisionedSettingsDraftOrigin,
} from '@/components/settings/identity/revisionedSettingsDraft';

const TeamManagedProviderEditItem = React.memo(function TeamManagedProviderEditItem(props: Readonly<{
    scope: Parameters<typeof useManagedIdentityProviders>[0];
    address: Readonly<{ serverId: string; teamId: string }>;
    connectionId: string;
    providerId: string;
    disabled: boolean;
}>) {
    const router = useRouter();
    const owner = React.useMemo(() => ({ kind: 'team' as const, teamId: props.address.teamId }), [props.address.teamId]);
    const providers = useManagedIdentityProviders(props.scope, owner);
    if (providers.state.kind !== 'ready' || !providers.state.items.some((provider) => provider.id === props.providerId)) return null;
    return <Item
        testID="team-identity-provider-edit"
        title={t('identityAdministration.edit')}
        disabled={props.disabled}
        onPress={() => router.push(teamIdentityConnectionProviderEditPath(props.address, props.connectionId, props.providerId))}
        showChevron
    />;
});

const AuthorizedConnectionDetail = React.memo(function AuthorizedConnectionDetail(props: Readonly<{
    scope: Parameters<typeof useIdentityAdministration>[0];
    teamId: string;
    connectionId: string;
    mutationsAvailable: boolean;
    requestApproval: (registration: ActionApprovalRegistration) => void;
    testReturn?: Readonly<{ purpose: string | null; resultHandle: string | null; error: string | null }>;
}>) {
    const router = useRouter();
    const { state, refresh } = useIdentityAdministration(props.scope, props.teamId);
    const client = React.useMemo(
        () => createIdentityAdministrationClient(props.scope, {
            onApprovalPending: props.requestApproval,
        }),
        [props.requestApproval, props.scope.accountId, props.scope.serverId],
    );
    const [pending, setPending] = React.useState<string | null>(null);
    const [actionFailure, setActionFailure] = React.useState<string | null>(null);

    // A typed Home outcome becomes one localized sentence, announced as well as
    // shown because it lands away from the control that was pressed.
    const reportActionFailure = React.useCallback((code: string) => {
        const message = identityAdministrationFailureMessage(code);
        setActionFailure(message);
        announceAccessibilityMessage(message);
    }, []);
    const [testDiagnostics, setTestDiagnostics] = React.useState<IdentityConnectionTestDiagnosticsV1 | null>(null);
    const [workosCandidates, setWorkosCandidates] = React.useState<readonly Readonly<{ connectionId: string; displayName: string; strategy: string; status: string }>[]>([]);
    const [workosReturnRefreshing, setWorkosReturnRefreshing] = React.useState(false);
    const portalReturnController = React.useRef(createWorkosPortalReturnController()).current;
    const handledTestReturnRef = React.useRef<string | null>(null);
    const connection = state.kind === 'ready'
        ? state.items.find((candidate) => candidate.id === props.connectionId) ?? null
        : null;
    const [settingsOrigin, setSettingsOrigin] = React.useState<RevisionedSettingsDraftOrigin | null>(null);
    const [settingsDirty, setSettingsDirty] = React.useState(false);
    const [settingsConflict, setSettingsConflict] = React.useState(false);
    const [oidcSettings, setOidcSettings] = React.useState<OidcConnectionSettingsDraft>({
        allowedUsers: '', allowedEmailDomains: '', groupsAny: '', groupsAll: '',
    });
    const [organizationLogin, setOrganizationLogin] = React.useState('');
    const editOidcSettings = React.useCallback((patch: Partial<OidcConnectionSettingsDraft>) => {
        setSettingsDirty(true);
        setOidcSettings((current) => ({ ...current, ...patch }));
    }, []);
    const editOrganizationLogin = React.useCallback((value: string) => {
        setSettingsDirty(true);
        setOrganizationLogin(value);
    }, []);
    const reloadConnectionSettings = React.useCallback(() => {
        if (!connection) return;
        setSettingsOrigin({ resourceId: connection.id, revision: connection.revision });
        setSettingsDirty(false);
        setSettingsConflict(false);
        if (connection.settings.kind === 'oidc') {
            setOidcSettings({
                allowedUsers: connection.settings.allowedUsers.join('\n'),
                allowedEmailDomains: connection.settings.allowedEmailDomains.join('\n'),
                groupsAny: connection.settings.groupsAny.join('\n'),
                groupsAll: connection.settings.groupsAll.join('\n'),
            });
        } else if (connection.settings.kind === 'github_app_identity') {
            setOrganizationLogin(connection.settings.organizationLogin);
        }
    }, [connection]);
    React.useEffect(() => {
        if (!connection) return;
        const next = { resourceId: connection.id, revision: connection.revision };
        const transition = revisionedSettingsDraftTransition({
            origin: settingsOrigin,
            current: next,
            dirty: settingsDirty,
        });
        if (transition === 'keep') return;
        if (transition === 'conflict') { setSettingsConflict(true); return; }
        reloadConnectionSettings();
    }, [connection, reloadConnectionSettings, settingsDirty, settingsOrigin]);

    const reconcileWorkos = React.useCallback(async () => {
        if (!connection || !connection.allowedActions.includes('teams.identity.workos.reconcile')) return;
        setPending('workos:reconcile'); setActionFailure(null);
        try {
            const applyResult = (value: TeamIdentityActionOutput<'teams.identity.workos.reconcile'>) => {
                if (value.outcome === 'selection_required') {
                    setWorkosCandidates(value.candidates);
                    // A new decision appears further down the screen than the
                    // control that was pressed, so it is announced as well as
                    // rendered; nothing is chosen on the caller's behalf.
                    announceAccessibilityMessage(t('identityAdministration.workosChooseConnection'));
                    return;
                }
                setWorkosCandidates([]);
                refresh();
            };
            const result = await client.execute(
                'teams.identity.workos.reconcile',
                { v: 1, teamId: props.teamId, connectionId: connection.id, expectedRevision: connection.revision },
                { onApprovalSucceeded: applyResult, onApprovalFailed: reportActionFailure },
            );
            if (!result.ok) {
                if ('approvalPending' in result) return;
                reportActionFailure(result.failure.code);
            } else applyResult(result.value);
        } finally { setPending(null); }
    }, [client, connection, props.teamId, refresh, reportActionFailure]);

    React.useEffect(() => {
        const reconcileOnReturn = () => {
            if (!portalReturnController.consumeReturn()) return;
            setWorkosReturnRefreshing(true);
            refresh();
        };
        const appStateSubscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') reconcileOnReturn();
        });
        const webWindow = typeof globalThis.window === 'undefined' ? null : globalThis.window;
        webWindow?.addEventListener?.('focus', reconcileOnReturn);
        return () => {
            appStateSubscription.remove();
            webWindow?.removeEventListener?.('focus', reconcileOnReturn);
        };
    }, [portalReturnController, refresh]);

    React.useEffect(() => {
        if (!workosReturnRefreshing) return;
        if (state.kind === 'loading' || (state.kind === 'ready' && state.refreshing)) return;
        setWorkosReturnRefreshing(false);
        if (state.kind === 'ready' && !state.stale && connection?.allowedActions.includes('teams.identity.workos.reconcile')) {
            void reconcileWorkos();
        } else {
            reportActionFailure('workos_reconcile_unavailable');
        }
    }, [connection, reconcileWorkos, state, workosReturnRefreshing]);

    React.useEffect(() => {
        const testReturn = props.testReturn;
        if (!testReturn || !connection || testReturn.purpose !== 'identity_connection_test') return;
        const key = `${props.teamId}\u0000${props.connectionId}\u0000${testReturn.resultHandle ?? ''}\u0000${testReturn.error ?? ''}`;
        if (handledTestReturnRef.current === key) return;
        handledTestReturnRef.current = key;
        setPending('test:return');
        setActionFailure(null);
        void (async () => {
            try {
                const applyConsumedDiagnostics = (diagnostics: IdentityConnectionTestDiagnosticsV1 | null) => {
                    setTestDiagnostics(diagnostics);
                    refresh();
                };
                const outcome = await runTeamIdentityProviderTestReturn({
                    ...testReturn,
                    teamId: props.teamId,
                    connectionId: props.connectionId,
                    consume: async (input) => await client.execute(
                        'teams.identity.connections.test.consume',
                        { v: 1, ...input },
                        {
                            onApprovalSucceeded: (value) => applyConsumedDiagnostics(value.diagnostics ?? null),
                            onApprovalFailed: reportActionFailure,
                        },
                    ),
                });
                if (outcome.kind === 'failed') reportActionFailure(outcome.code);
                else if (outcome.kind === 'consumed') applyConsumedDiagnostics(outcome.diagnostics);
            } catch {
                reportActionFailure('home_unreachable');
            } finally {
                setPending(null);
                router.replace(teamIdentityConnectionPath(
                    { serverId: props.scope.serverId, teamId: props.teamId },
                    props.connectionId,
                ));
            }
        })();
    }, [client, connection, props.connectionId, props.scope.serverId, props.teamId, props.testReturn, refresh, reportActionFailure, router]);

    if (state.kind === 'loading') return <ItemGroup><Item title={t('common.loading')} leftElement={<ActivitySpinner />} showChevron={false} /></ItemGroup>;
    if (state.kind === 'unavailable') return <ItemGroup><Item testID="identity-connection-unavailable" title={identityAdministrationFailureMessage(state.failure.code)} detail={state.failure.retryable ? t('common.retry') : undefined} onPress={state.failure.retryable ? refresh : undefined} showChevron={false} /></ItemGroup>;
    if (!connection) return <ItemGroup><Item testID="identity-connection-not-found" title={t('teams.errors.notFound')} showChevron={false} /></ItemGroup>;

    const mode = identityConnectionMode(connection) === 'sign_in_time_groups' ? t('teams.authentication.mode.signInTimeGroups') : t('teams.authentication.mode.signInOnly');
    const testStatus = identityConnectionTestStatus(connection);
    const can = (actionId: (typeof connection.allowedActions)[number]) => connection.allowedActions.includes(actionId);
    const projectionCurrent = !state.refreshing && !state.stale;
    const mutationBusy = pending !== null || workosReturnRefreshing || !projectionCurrent;
    const settle = (result: IdentityAdministrationActionResult<unknown>) => {
        if (result.ok) {
            refresh();
            return;
        }
        if ('approvalPending' in result) return;
        const code = result.failure.code;
        reportActionFailure(code);
        if (identityAdministrationFailure(code).refreshResolves) refresh();
    };

    const runLifecycle = async (actionId: 'teams.identity.connections.enable' | 'teams.identity.connections.disable') => {
        setPending(actionId); setActionFailure(null);
        try {
            settle(await client.execute(
                actionId,
                { v: 1, teamId: props.teamId, connectionId: connection.id, expectedRevision: connection.revision },
                { onApprovalSucceeded: refresh, onApprovalFailed: reportActionFailure },
            ));
        }
        finally { setPending(null); }
    };

    const saveSettings = async () => {
        if (!props.mutationsAvailable || !can('teams.identity.connections.settings.update')) return;
        const settings = connection.settings.kind === 'oidc'
            ? connectionSettingsFromDraft(oidcSettings)
            : connection.settings.kind === 'github_app_identity' && organizationLogin.trim()
                ? { v: 1 as const, kind: 'github_app_identity' as const, organizationLogin: organizationLogin.trim() }
                : null;
        if (!settings) { reportActionFailure('invalid_parameters'); return; }
        setPending('settings'); setActionFailure(null);
        try {
            const applySettingsSuccess = () => {
                setSettingsDirty(false);
                setSettingsConflict(false);
                refresh();
            };
            const result = await client.execute('teams.identity.connections.settings.update', {
                v: 1, teamId: props.teamId, connectionId: connection.id,
                expectedRevision: settingsOrigin?.resourceId === connection.id
                    ? settingsOrigin.revision
                    : connection.revision,
                settings,
            }, {
                onApprovalSucceeded: applySettingsSuccess,
                onApprovalFailed: reportActionFailure,
            });
            if (!result.ok) {
                if ('approvalPending' in result) return;
                reportActionFailure(result.failure.code);
                if (result.failure.code === 'identity_connection_conflict') {
                    setSettingsConflict(true);
                    refresh();
                }
            }
            else applySettingsSuccess();
        } finally { setPending(null); }
    };

    const test = async () => {
        setPending('test'); setActionFailure(null); setTestDiagnostics(null);
        try {
            const continueTest = async (value: TeamIdentityActionOutput<'teams.identity.connections.test.start'>) => {
                if (!await openExternalUrl(value.authorizeUrl)) reportActionFailure('identity_connection_test_open_failed');
            };
            const result = await client.execute(
                'teams.identity.connections.test.start',
                { v: 1, teamId: props.teamId, connectionId: connection.id, expectedRevision: connection.revision },
                { onApprovalSucceeded: continueTest, onApprovalFailed: reportActionFailure },
            );
            if (!result.ok) {
                if ('approvalPending' in result) return;
                reportActionFailure(result.failure.code);
                return;
            }
            await continueTest(result.value);
        } finally { setPending(null); }
    };

    const openWorkosPortal = async () => {
        if (!await Modal.confirm(t('identityAdministration.workosSetupSso'), t('teams.authentication.subtitle'), { cancelText: t('common.cancel'), confirmText: t('common.continue') })) return;
        const intent = 'sso' as const;
        setPending(`workos:${intent}`); setActionFailure(null);
        try {
            const continuePortal = async (value: TeamIdentityActionOutput<'teams.identity.workos.adminPortalLink.create'>) => {
                let isHttps = false;
                try { isHttps = new URL(value.url).protocol === 'https:'; } catch { /* fail closed */ }
                if (!isHttps || !await openExternalUrl(value.url)) reportActionFailure('workos_portal_open_failed');
                else portalReturnController.markOpened();
            };
            const result = await client.execute(
                'teams.identity.workos.adminPortalLink.create',
                { v: 1, teamId: props.teamId, connectionId: connection.id, intent },
                { onApprovalSucceeded: continuePortal, onApprovalFailed: reportActionFailure },
            );
            if (!result.ok) {
                if ('approvalPending' in result) return;
                reportActionFailure(result.failure.code);
                return;
            }
            await continuePortal(result.value);
        } finally { setPending(null); }
    };

    const chooseWorkos = async (candidate: Readonly<{
        connectionId: string; displayName: string; strategy: string; status: string;
    }>) => {
        const workosConnectionId = candidate.connectionId;
        // Choosing fixes the provider namespace every future identity under this
        // binding is issued in, so the choice is confirmed by name rather than
        // committed by a single press on a row that appeared mid-screen.
        if (!await Modal.confirm(
            t('identityAdministration.workosChooseConnection'),
            [
                candidate.displayName,
                `${workosConnectionStrategyLabel(candidate.strategy)} · ${workosConnectionStatusLabel(candidate.status)}`,
            ].join('\n'),
            { cancelText: t('common.cancel'), confirmText: t('common.continue') },
        )) return;
        setPending(`workos:set:${workosConnectionId}`); setActionFailure(null);
        try {
            const applyConnection = () => { setWorkosCandidates([]); refresh(); };
            const result = await client.execute(
                'teams.identity.workos.connection.set',
                { v: 1, teamId: props.teamId, connectionId: connection.id, expectedRevision: connection.revision, workosConnectionId },
                { onApprovalSucceeded: applyConnection, onApprovalFailed: reportActionFailure },
            );
            if (!result.ok) {
                if ('approvalPending' in result) return;
                reportActionFailure(result.failure.code);
            } else applyConnection();
        } finally { setPending(null); }
    };

    const remove = async () => {
        setPending('remove'); setActionFailure(null);
        try {
            const preflight = await client.execute('teams.identity.connections.remove.preview', { v: 1, teamId: props.teamId, connectionId: connection.id, expectedRevision: connection.revision });
            if (!preflight.ok) { reportActionFailure(preflight.failure.code); return; }
            const impact = t('identityAdministration.teamRemoveImpact', { accounts: preflight.value.impact.linkedAccounts, alternateLogins: preflight.value.impact.accountsRequiringAlternateLogin, directories: preflight.value.impact.directorySources, groups: preflight.value.impact.externalGroupBindings, memberships: preflight.value.impact.managedMemberships });
            if (!preflight.value.canRemove) {
                // Each blocker names a dependent and where it is resolved; the
                // counts alone would hide why removal is refused.
                const reasons = preflight.value.blockers.map((blocker) => {
                    const message = identityAdministrationFailureMessage(blocker);
                    const label = identityAdministrationFailureRecoveryLabel(identityAdministrationFailure(blocker).recovery);
                    return label ? `${message} ${label}.` : message;
                });
                await Modal.alertAsync(t('identityAdministration.remove'), [...reasons, impact].join('\n'));
                return;
            }
            if (!await Modal.confirm(t('identityAdministration.removeTitle', { name: connection.provider.displayName }), impact, { cancelText: t('common.cancel'), confirmText: t('identityAdministration.remove'), destructive: true })) return;
            const finishRemoval = () => router.back();
            const result = await client.execute(
                'teams.identity.connections.remove',
                { v: 1, teamId: props.teamId, connectionId: connection.id, expectedRevision: preflight.value.connection.revision },
                { onApprovalSucceeded: finishRemoval, onApprovalFailed: reportActionFailure },
            );
            if (!result.ok) {
                if ('approvalPending' in result) return;
                reportActionFailure(result.failure.code);
            } else finishRemoval();
        } finally { setPending(null); }
    };

    return <>
        {state.stale ? <ItemGroup footer={t('teams.stale.label')}><Item title={t('teams.unavailable.offline')} detail={t('common.retry')} onPress={refresh} showChevron={false} /></ItemGroup> : null}
        {workosReturnRefreshing ? <ItemGroup><Item testID="identity-workos-return-checking" title={t('identityAdministration.workosCheckSetup')} detail={t('common.loading')} loading accessibilityLiveRegion="polite" showChevron={false} /></ItemGroup> : null}
        <ItemGroup title={connection.provider.displayName}>
            <Item testID="identity-connection-status" title={t('teams.authentication.detail.status')} detail={connectionStateLabel(connection.state)} showChevron={false} />
            <Item testID="identity-connection-mode" title={t('teams.authentication.detail.mode')} detail={mode} showChevron={false} />
            <Item testID="identity-connection-provider" title={t('teams.authentication.detail.provider')} detail={identityProviderKindLabel(connection.provider.kind)} showChevron={false} />
            <Item
                testID="identity-connection-test-status"
                title={t('identityAdministration.test')}
                detail={pending === 'test:return'
                    ? t('common.loading')
                    : testStatus === 'current'
                    ? t('identityAdministration.tested')
                    : testStatus === 'stale'
                        ? t('identityAdministration.staleTest')
                        : t('identityAdministration.needsTest')}
                loading={pending === 'test:return'}
                accessibilityLiveRegion={pending === 'test:return' ? 'polite' : undefined}
                showChevron={false}
            />
        </ItemGroup>
        {testDiagnostics ? <IdentityTestDiagnosticsGroup diagnostics={testDiagnostics} groupMappings /> : null}
        {settingsConflict ? <ItemGroup footer={t('identityAdministration.settingsChangedElsewhere')}>{settingsOrigin?.resourceId !== connection.id || connection.revision > settingsOrigin.revision ? <Item testID="identity-settings-reload-conflict" title={t('common.refresh')} disabled={pending !== null || !props.mutationsAvailable} onPress={reloadConnectionSettings} showChevron={false} /> : <Item testID="identity-settings-refresh-conflict" title={t('common.retry')} disabled={pending !== null} onPress={refresh} showChevron={false} />}</ItemGroup> : null}
        {connection.settings.kind === 'oidc' ? <ItemGroup title={t('teams.authentication.detail.restrictions')}>
            <FieldItem label={t('teams.authentication.detail.allowedUsers')}><TextInput testID="identity-settings-allowed-users" accessibilityLabel={t('teams.authentication.detail.allowedUsers')} value={oidcSettings.allowedUsers} editable={projectionCurrent && props.mutationsAvailable && can('teams.identity.connections.settings.update')} multiline onChangeText={(value) => editOidcSettings({ allowedUsers: value })} /></FieldItem>
            <FieldItem label={t('teams.authentication.detail.allowedDomains')}><TextInput testID="identity-settings-allowed-domains" accessibilityLabel={t('teams.authentication.detail.allowedDomains')} value={oidcSettings.allowedEmailDomains} editable={projectionCurrent && props.mutationsAvailable && can('teams.identity.connections.settings.update')} multiline autoCapitalize="none" onChangeText={(value) => editOidcSettings({ allowedEmailDomains: value })} /></FieldItem>
            <FieldItem label={t('identityAdministration.groupsAny')}><TextInput testID="identity-settings-groups-any" accessibilityLabel={t('identityAdministration.groupsAny')} value={oidcSettings.groupsAny} editable={projectionCurrent && props.mutationsAvailable && can('teams.identity.connections.settings.update')} multiline onChangeText={(value) => editOidcSettings({ groupsAny: value })} /></FieldItem>
            <FieldItem label={t('identityAdministration.groupsAll')}><TextInput testID="identity-settings-groups-all" accessibilityLabel={t('identityAdministration.groupsAll')} value={oidcSettings.groupsAll} editable={projectionCurrent && props.mutationsAvailable && can('teams.identity.connections.settings.update')} multiline onChangeText={(value) => editOidcSettings({ groupsAll: value })} /></FieldItem>
            {can('teams.identity.connections.settings.update') ? <Item testID="identity-settings-save" title={t('identityAdministration.save')} loading={pending === 'settings'} disabled={mutationBusy || settingsConflict || !settingsDirty || !props.mutationsAvailable} onPress={() => void saveSettings()} showChevron={false} /> : null}
        </ItemGroup> : null}
        {connection.settings.kind === 'github_app_identity' ? <ItemGroup title={t('teams.authentication.detail.configuration')}>
            <FieldItem label={t('teams.authentication.detail.organization')}><TextInput testID="identity-settings-organization" accessibilityLabel={t('teams.authentication.detail.organization')} value={organizationLogin} editable={projectionCurrent && props.mutationsAvailable && can('teams.identity.connections.settings.update')} autoCapitalize="none" autoCorrect={false} onChangeText={editOrganizationLogin} /></FieldItem>
            {can('teams.identity.connections.settings.update') ? <Item testID="identity-settings-save" title={t('identityAdministration.save')} loading={pending === 'settings'} disabled={mutationBusy || settingsConflict || !settingsDirty || !props.mutationsAvailable} onPress={() => void saveSettings()} showChevron={false} /> : null}
        </ItemGroup> : null}
        {connection.lastObservation?.kind === 'workos_sso' && connection.lastObservation.presentation ? <ItemGroup title={t('teams.authentication.detail.configuration')}><Item testID="identity-workos-current-connection" title={t('teams.authentication.detail.connection')} detail={connection.lastObservation.presentation.displayName} subtitle={`${workosConnectionStrategyLabel(connection.lastObservation.presentation.strategy)} · ${workosConnectionStatusLabel(connection.lastObservation.presentation.status)}`} showChevron={false} /></ItemGroup> : null}
        {connection.provider.kind === 'oidc' || connection.provider.kind === 'github_app_identity' ? <IdentityConnectionGroupMappings scope={props.scope} address={{ serverId: props.scope.serverId, teamId: props.teamId }} connectionId={connection.id} mutationsAvailable={props.mutationsAvailable && projectionCurrent} requestApproval={props.requestApproval} /> : null}
        {workosCandidates.length > 0 ? (
            <ItemGroup
                title={t('identityAdministration.workosChooseConnection')}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('identityAdministration.workosChooseConnection')}
            >
                {workosCandidates.map((candidate) => {
                    const detail = `${workosConnectionStrategyLabel(candidate.strategy)} · ${workosConnectionStatusLabel(candidate.status)}`;
                    return (
                        <Item
                            key={candidate.connectionId}
                            testID={`identity-workos-candidate:${candidate.connectionId}`}
                            title={candidate.displayName}
                            subtitle={detail}
                            // The row's own name and strategy/status carry the
                            // whole choice, so assistive technology reads the
                            // same thing the eye does instead of "button".
                            accessibilityLabel={`${candidate.displayName}, ${detail}`}
                            accessibilityRole="radio"
                            webRole="radio"
                            accessibilityChecked={false}
                            disabled={mutationBusy || !props.mutationsAvailable}
                            onPress={() => void chooseWorkos(candidate)}
                            showChevron={false}
                        />
                    );
                })}
            </ItemGroup>
        ) : null}
        {actionFailure ? <ItemGroup><Item testID="identity-connection-failure" title={actionFailure} showChevron={false} /></ItemGroup> : null}
        <ItemGroup title={t('identityAdministration.actions')}>
            {connection.provider.kind === 'oidc' ? <TeamManagedProviderEditItem scope={props.scope} address={{ serverId: props.scope.serverId, teamId: props.teamId }} connectionId={connection.id} providerId={connection.provider.id} disabled={mutationBusy || !props.mutationsAvailable} /> : null}
            {can('teams.identity.connections.test.start') ? <Item testID="team-identity-test" title={t('identityAdministration.test')} loading={pending === 'test'} disabled={mutationBusy || !props.mutationsAvailable} onPress={() => void test()} showChevron={false} /> : null}
            {can('teams.identity.connections.enable') ? <Item testID="team-identity-enable" title={t('identityAdministration.enable')} loading={pending === 'teams.identity.connections.enable'} disabled={mutationBusy || !props.mutationsAvailable} onPress={() => void runLifecycle('teams.identity.connections.enable')} showChevron={false} /> : null}
            {can('teams.identity.connections.disable') ? <Item testID="team-identity-disable" title={t('identityAdministration.disable')} loading={pending === 'teams.identity.connections.disable'} disabled={mutationBusy || !props.mutationsAvailable} onPress={() => void runLifecycle('teams.identity.connections.disable')} showChevron={false} /> : null}
            {can('teams.identity.workos.adminPortalLink.create') ? <><Item testID="team-identity-workos-sso" title={t('identityAdministration.workosSetupSso')} disabled={mutationBusy || !props.mutationsAvailable} onPress={() => void openWorkosPortal()} showChevron={false} /><Item testID="team-identity-workos-directory" title={t('identityAdministration.workosSetupDirectory')} disabled={mutationBusy || !props.mutationsAvailable} onPress={() => router.push(teamDirectoryPath({ serverId: props.scope.serverId, teamId: props.teamId }))} showChevron /></> : null}
            {can('teams.identity.workos.reconcile') ? <Item testID="team-identity-workos-reconcile" title={t('identityAdministration.workosCheckSetup')} disabled={mutationBusy || !props.mutationsAvailable} onPress={() => void reconcileWorkos()} showChevron={false} /> : null}
            {can('teams.identity.connections.remove') ? <Item testID="team-identity-remove" title={t('identityAdministration.remove')} destructive disabled={mutationBusy || !props.mutationsAvailable} onPress={() => void remove()} showChevron={false} /> : null}
        </ItemGroup>
    </>;
});

export const IdentityConnectionDetailScreen = React.memo(function IdentityConnectionDetailScreen(props: Readonly<{
    serverId: string;
    teamId: string;
    connectionId: string;
    testReturn?: Readonly<{ purpose: string | null; resultHandle: string | null; error: string | null }>;
}>) {
    return <TeamSection serverId={props.serverId} teamId={props.teamId} title={t('teams.tabs.authentication')}>{({ team, scope, canMutate, requestApproval }) => team.capabilities.manageAuthentication ? <AuthorizedConnectionDetail scope={scope} teamId={team.id} connectionId={props.connectionId} mutationsAvailable={canMutate} requestApproval={requestApproval} testReturn={props.testReturn} /> : <ItemGroup><Item title={t('teams.errors.forbidden')} showChevron={false} /></ItemGroup>}</TeamSection>;
});
