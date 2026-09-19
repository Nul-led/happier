import * as React from 'react';
import { useNavigation, useRouter } from 'expo-router';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { useActionApprovalContinuation } from '@/components/approvals/useActionApprovalContinuation';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text } from '@/components/ui/text/Text';
import { useHomeAdministration } from '@/hooks/home/useHomeAdministration';
import { refreshHomeGovernanceSnapshot } from '@/sync/engine/home/governance/homeGovernanceEngine';
import { serverAccountScopeKeySuffix } from '@/sync/domains/scope/serverAccountScope';
import { t } from '@/text';

import type { HomeAdministrationContext } from './homeAdministrationContext';

const styles = StyleSheet.create((theme) => ({
    centered: {
        paddingVertical: 48,
        paddingHorizontal: 24,
        alignItems: 'center',
        gap: 12,
    },
    centeredTitle: {
        color: theme.colors.text.primary,
        textAlign: 'center',
    },
    centeredBody: {
        color: theme.colors.text.secondary,
        textAlign: 'center',
    },
}));

/**
 * A message that occupies the surface because there is genuinely nothing else
 * truthful to show. Every state that *does* have retained content renders that
 * content instead, with an explanation attached.
 */
const HomeAdministrationMessage = React.memo(function HomeAdministrationMessage(props: Readonly<{
    title: string;
    body?: string;
    busy?: boolean;
    announcement?: 'polite' | 'assertive';
    testID?: string;
}>) {
    return (
        <View
            style={styles.centered}
            testID={props.testID}
            accessibilityRole={props.announcement === 'assertive' ? 'alert' : undefined}
            accessibilityLiveRegion={props.announcement}
            accessibilityState={props.busy ? { busy: true } : undefined}
        >
            {props.busy ? <ActivitySpinner /> : null}
            <Text style={styles.centeredTitle}>{props.title}</Text>
            {props.body ? (
                <Text style={styles.centeredBody}>{props.body}</Text>
            ) : null}
        </View>
    );
});

const HomeAdministrationSetupRequired = React.memo(function HomeAdministrationSetupRequired(props: Readonly<{
    retry: () => void;
}>) {
    const { theme } = useUnistyles();
    return (
        <ItemGroup
            title={t('homeGovernance.setupRequiredTitle')}
            footer={t('homeGovernance.setupRequiredBody')}
        >
            <Item
                testID="home-admin-setup-required"
                title={t('homeGovernance.setupRequiredTitle')}
                subtitle={t('homeGovernance.setupRequiredBody')}
                icon={<Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />}
                showChevron={false}
            />
            <Item
                testID="home-admin-setup-refresh"
                title={t('common.refresh')}
                icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />}
                onPress={props.retry}
                showChevron={false}
            />
        </ItemGroup>
    );
});

/**
 * The one place Home Administration decides how a Home's condition is shown.
 *
 * Overview, People and Policies all render through this, so the freshness
 * notice, the offline explanation, the retry and the owner-setup state cannot
 * drift between them. Sections receive the projection only once it exists, so
 * no section has to defend itself against a Home that has not answered — and
 * none of them re-derives when Home/Account-qualified section state must be
 * discarded.
 */
export const HomeAdministrationSection = React.memo(function HomeAdministrationSection(props: Readonly<{
    serverId: string;
    title: string;
    presentation?: 'item-list' | 'virtualized-list';
    children: (context: HomeAdministrationContext, header?: React.ReactNode) => React.ReactNode;
}>) {
    const { theme } = useUnistyles();
    const navigation = useNavigation();
    const router = useRouter();
    const binding = useHomeAdministration(props.serverId);
    const scope = binding.kind === 'bound' ? binding.scope : null;
    const scopeServerId = scope?.serverId ?? '';
    const scopeAccountId = scope?.accountId ?? '';
    const scopeKey = scope ? serverAccountScopeKeySuffix(scope) : `unbound:${props.serverId}`;
    const approvalRefresh = React.useCallback(() => {
        if (scopeServerId && scopeAccountId) {
            void refreshHomeGovernanceSnapshot({ serverId: scopeServerId, accountId: scopeAccountId });
        }
    }, [scopeAccountId, scopeServerId]);
    const {
        approvalId,
        approvalStatus,
        approvalPending,
        isLoading: approvalLoading,
        error: approvalError,
        requestApproval,
    } = useActionApprovalContinuation({
        scopeKey,
        serverId: props.serverId,
        onExecuted: approvalRefresh,
    });

    React.useEffect(() => {
        navigation.setOptions({ title: props.title });
    }, [navigation, props.title]);

    const retry = React.useCallback(() => {
        if (!scopeServerId || !scopeAccountId) return;
        void refreshHomeGovernanceSnapshot({ serverId: scopeServerId, accountId: scopeAccountId });
    }, [scopeServerId, scopeAccountId]);

    if (binding.kind === 'resolving') {
        return <HomeAdministrationMessage title={t('homeGovernance.loading')} busy announcement="polite" testID="home-admin-resolving" />;
    }

    if (binding.kind === 'unknown_home') {
        return (
            <HomeAdministrationMessage
                title={t('homeGovernance.unavailableTitle')}
                body={t('homeGovernance.notObservedBody')}
                announcement="assertive"
                testID="home-admin-unknown-home"
            />
        );
    }

    if (binding.kind === 'signed_out') {
        // Being signed out is a fact about this device, not a refusal by the
        // Home. Saying "you may not administer this Home" here would be wrong
        // and would send someone looking for authority they may already have.
        return (
            <HomeAdministrationMessage
                title={t('homeGovernance.signedOutTitle')}
                body={t('homeGovernance.signedOutBody')}
                announcement="assertive"
                testID="home-admin-signed-out"
            />
        );
    }

    const { state, homeName } = binding;

    if (state.kind === 'unobserved' || state.kind === 'loading') {
        return <HomeAdministrationMessage title={t('homeGovernance.loading')} busy announcement="polite" testID="home-admin-loading" />;
    }

    if (state.kind === 'setup_required') {
        return (
            <ItemList>
                <HomeAdministrationSetupRequired retry={retry} />
            </ItemList>
        );
    }

    if (state.kind === 'unavailable') {
        // `forbidden` and `unauthorized` are the Home's settled answers about
        // this Account, and `unsupported` is its settled answer about itself.
        // None of them is offered a retry that would ask the same question again.
        const denied = state.error.kind === 'forbidden' || state.error.kind === 'unauthorized';
        const unsupported = state.error.kind === 'unsupported';
        return (
            <ItemList>
                <HomeAdministrationMessage
                    title={denied ? t('homeGovernance.forbiddenTitle') : t('homeGovernance.unavailableTitle')}
                    body={denied
                        ? t('homeGovernance.forbiddenBody')
                        : unsupported
                            ? t('homeGovernance.unsupportedBody')
                            : t('homeGovernance.unavailableBody')}
                    announcement="assertive"
                    testID="home-admin-unavailable"
                />
                {state.retryable ? (
                    <ItemGroup>
                        <Item
                            testID="home-admin-retry"
                            title={t('homeGovernance.retry')}
                            icon={<Icon name="arrow-clockwise" size={29} color={theme.colors.text.secondary} />}
                            onPress={retry}
                            showChevron={false}
                        />
                    </ItemGroup>
                ) : null}
            </ItemList>
        );
    }

    const context: HomeAdministrationContext = {
        scope: state.scope,
        homeName,
        projection: state.projection,
        mutationsAvailable: state.mutationsAvailable && !approvalPending,
        approvalPending,
        requestApproval,
        refresh: retry,
    };

    const header = (
        <>
            {approvalId ? (
                <ItemGroup>
                    <Item
                        testID="home-admin-approval"
                        title={t('approvals.title')}
                        subtitle={approvalError
                            ? t('approvals.loadError')
                            : approvalLoading || approvalStatus === 'open' || approvalStatus === 'approved' || approvalStatus === 'executing'
                                ? t('approvals.status.open')
                                : t('approvals.details')}
                        accessibilityLiveRegion={approvalError ? 'assertive' : 'polite'}
                        onPress={() => router.push(`/inbox/approvals/${encodeURIComponent(approvalId)}?serverId=${encodeURIComponent(props.serverId)}`)}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
            {/* Retained content stays on screen; the reason it may be behind is
                stated once, at the top, rather than disabling the whole view. */}
            {state.stale ? (
                <ItemGroup
                    footer={state.error
                        ? t('homeGovernance.offlineNotice')
                        : t('homeGovernance.staleNotice')}
                >
                    <Item
                        testID="home-admin-stale"
                        title={state.error ? t('homeGovernance.offlineNotice') : t('homeGovernance.refreshing')}
                        // How old the retained state is, not only that it is
                        // old. A projection observed before this device could
                        // record when is shown without a manufactured time.
                        subtitle={state.lastObservedAt === null
                            ? undefined
                            : t('homeGovernance.lastUpdated', {
                                time: new Date(state.lastObservedAt).toLocaleString(),
                            })}
                        icon={<Icon name="warning" size={29} color={theme.colors.state.warning.foreground} />}
                        onPress={retry}
                        detail={t('homeGovernance.retry')}
                        accessibilityLiveRegion="polite"
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}

            {/* An ownerless Home is explained, never offered a claim button:
                the first owner is assigned by someone with server access. */}
            {state.projection.setupState === 'setup_required' ? (
                <HomeAdministrationSetupRequired retry={retry} />
            ) : null}
        </>
    );

    // Section-local drafts, in-flight markers and errors belong to the exact
    // Home and Account they were entered for. Discarding them here is what keeps
    // each section from re-deriving that rule and eventually disagreeing about
    // it, and what stops a draft from being applied as a different Account.
    if (props.presentation === 'virtualized-list') {
        return (
            <React.Fragment key={scopeKey}>
                {props.children(context, header)}
            </React.Fragment>
        );
    }

    return (
        <ItemList>
            {header}

            <React.Fragment key={scopeKey}>
                {props.children(context)}
            </React.Fragment>
        </ItemList>
    );
});
