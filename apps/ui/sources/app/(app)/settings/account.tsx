import React, { useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { useAuth } from '@/auth/context/AuthContext';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SettingsCatalogPageChildren } from '@/components/settings/SettingsCatalogOverviewGroup';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useSettingMutable, useProfile } from '@/sync/domains/state/storage';
import { sync } from '@/sync/sync';
import { useUnistyles } from 'react-native-unistyles';
import { Switch } from '@/components/ui/forms/Switch';
import { useConnectAccount } from '@/hooks/auth/useConnectAccount';
import { getDisplayName } from '@/sync/domains/profiles/profile';
import { useHappyAction } from '@/hooks/ui/useHappyAction';
import { HappyError } from '@/utils/errors/errors';
import { setAccountUsername } from '@/sync/api/account/apiUsername';
import { storage } from '@/sync/domains/state/storageStore';
import { useFriendsEnabled } from '@/hooks/server/useFriendsEnabled';
import { useFriendsIdentityReadiness } from '@/hooks/server/useFriendsIdentityReadiness';
import { ProviderIdentityItems } from '@/components/account/ProviderIdentityItems';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { useRouter } from 'expo-router';
import { isRunningOnMac } from '@/utils/platform/platform';
import { isWebMobileLikeQrScannerHost } from '@/utils/platform/webMobileHeuristics';
import { canUseCurrentDeviceQrScanner } from '@/utils/platform/qrScannerSupport';
import { ACCOUNT_ERASURE_CONFIRMATION_V1 } from '@happier-dev/protocol';
import { Icon } from '@/components/ui/icons/Icon';
import { presentFirstKeyCredentialLifecycle } from '@/components/account/presentFirstKeyCredentialLifecycle';
import { deleteCurrentAccount } from '@/sync/api/account/deleteCurrentAccount';
import { accountErasureFailureNotice } from '@/components/settings/home/governance/homeGovernanceLabels';
import { AccountDeletedLocalCleanupError, completeAccountDeletion } from '@/components/settings/account/accountDeletionLifecycle';
import { SettingsHistorySection } from '@/components/settings/account/SettingsHistorySection';
import { AccountServiceSettingsSection } from '@/components/settings/account/AccountServiceSettingsSection';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { ADD_HOME_RESTORE_PATH } from '@/auth/pairing/homeQrEntryIntent';
import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';

export default React.memo(() => {
    const { theme } = useUnistyles();
    const auth = useAuth();
    const router = useRouter();
    const { width, height } = useWindowDimensions();
    const [accountDeletionPending, setAccountDeletionPending] = useState(false);
    const [analyticsOptOut, setAnalyticsOptOut] = useSettingMutable('analyticsOptOut');
    const [crashReportsOptOut, setCrashReportsOptOut] = useSettingMutable('crashReportsOptOut');
    const { connectAccount, isLoading: isConnecting } = useConnectAccount();
    const profile = useProfile();
    const friendsIdentityReadiness = useFriendsIdentityReadiness();
    const friendsEnabled = useFriendsEnabled();
    const applyProfile = storage((state) => state.applyProfile);
    const activeServer = useActiveServerSnapshot();
    const activeHomeName = getServerProfileById(activeServer.serverId)?.name.trim()
        || activeServer.serverUrl.trim()
        || t('settingsAccount.currentHome');
    // Profile display values
    const displayName = getDisplayName(profile);
    const canSetUsername =
        friendsEnabled &&
        !friendsIdentityReadiness.isLoadingFeatures &&
        friendsIdentityReadiness.gate.gateVariant === 'username';

    const [savingUsername, saveUsername] = useHappyAction(async () => {
        if (!auth.credentials) return;
        if (!canSetUsername) return;

        const next = await Modal.prompt(
            t('profile.username'),
            undefined,
            {
                placeholder: t('profile.username'),
                defaultValue: profile.username ?? undefined,
                confirmText: t('common.save'),
                cancelText: t('common.cancel'),
            },
        );
        if (next == null) return;

        try {
            const res = await setAccountUsername(auth.credentials, next);
            applyProfile({ ...profile, username: res.username });
        } catch (e) {
            if (e instanceof HappyError) {
                const msg =
                    e.message === 'username-taken' ? t('friends.username.taken')
                        : e.message === 'invalid-username' ? t('friends.username.invalid')
                            : e.message === 'username-disabled' ? t('friends.username.disabled')
                                : e.message === 'friends-disabled' ? t('friends.disabled')
                                    : e.message;
                await Modal.alert(t('common.error'), msg);
                return;
            }
            throw e;
        }
    });

    const handleLogout = async () => {
        const confirmed = await Modal.confirm(
            t('settingsAccount.logoutHome', { home: activeHomeName }),
            t('settingsAccount.logoutHomeConfirm', { home: activeHomeName }),
            {
                confirmText: t('settingsAccount.logoutHome', { home: activeHomeName }),
                destructive: true,
            },
        );
        if (confirmed) {
            await presentFirstKeyCredentialLifecycle({
                run: async () =>
                    await auth.logout({
                        beforeMutation: () =>
                            router.replace('/'),
                    }),
            });
        }
    };
    const handleForgetAllCredentials = async () => {
        const confirmed = await Modal.confirm(
            t('settingsAccount.forgetAllCredentials'),
            t('settingsAccount.forgetAllCredentialsConfirm'),
            {
                confirmText: t('settingsAccount.forgetAllCredentials'),
                destructive: true,
            },
        );
        if (!confirmed) return;
        let routed = false;
        const routeAfterAuthorization = () => {
            if (routed) return;
            routed = true;
            router.replace('/');
        };
        await presentFirstKeyCredentialLifecycle({
            run: async () =>
                await auth.logout({
                    scope: 'all-credentials',
                    beforeMutation: routeAfterAuthorization,
                }),
            onCompleted: routeAfterAuthorization,
        });
    };
    const handleDeleteAccount = async () => {
        if (accountDeletionPending) return;
        const confirmation = await Modal.prompt(t('settingsAccount.deleteAccountConfirmTitle'), t('settingsAccount.deleteAccountConfirmBody'), { placeholder: ACCOUNT_ERASURE_CONFIRMATION_V1, confirmText: t('settingsAccount.deleteAccount') });
        if (confirmation === null) return;
        if (confirmation.trim() !== ACCOUNT_ERASURE_CONFIRMATION_V1) { await Modal.alertAsync(t('settingsAccount.deleteAccountInvalidTitle'), t('settingsAccount.deleteAccountInvalidBody')); return; }
        const credentials = auth.credentials;
        const deletionScope = getActiveServerAccountScope();
        if (!credentials || !deletionScope) { await Modal.alertAsync(t('common.error'), t('settingsAccount.deleteAccountFailed')); return; }
        setAccountDeletionPending(true);
        let runDeletionCleanup = async () => await completeAccountDeletion({
            scope: deletionScope,
            deleteCurrentAccount: async () => await deleteCurrentAccount(credentials),
            logout: auth.logout,
            replace: (path) => router.replace(path),
        });
        try {
            while (true) {
                try {
                    await presentFirstKeyCredentialLifecycle({ run: runDeletionCleanup });
                    break;
                } catch (error) {
                    if (!(error instanceof AccountDeletedLocalCleanupError)) throw error;
                    let retry = false;
                    await Modal.alertAsync(
                        t('settingsAccount.deleteAccountCleanupFailedTitle'),
                        t('settingsAccount.deleteAccountCleanupFailed'),
                        [
                            { text: t('common.cancel'), style: 'cancel' },
                            { text: t('common.retry'), onPress: () => { retry = true; } },
                        ],
                    );
                    if (!retry) break;
                    runDeletionCleanup = error.retryLocalCleanup;
                }
            }
        } catch (error) {
            // The Home's typed verdict names the real obstacle — the last Home
            // or Team owner must hand ownership on first — so it is shown
            // through the same owner that names it for administrators. Only an
            // answer without a verdict keeps the "not confirmed" notice.
            const notice = accountErasureFailureNotice(error);
            await Modal.alertAsync(notice.title, notice.body);
        }
        finally { setAccountDeletionPending(false); }
    };

    const isPhoneSizedWeb = Platform.OS === 'web' && isWebMobileLikeQrScannerHost({ width, height });
    const showAddYourPhone = isRunningOnMac() || (Platform.OS === 'web' && !isPhoneSizedWeb);
    // Only Link new device needs this device's scanner. Add another Home opens the
    // shared add_home restore entry, which falls back to pasting a pairing link.
    const showLinkNewDevice = canUseCurrentDeviceQrScanner();
    return (
        <>
            <ItemList>
                {/* Account Info */}
                <ItemGroup title={t('settingsAccount.accountInformation')}>
                    <Item
                        title={t('settingsAccount.status')}
                        detail={auth.isAuthenticated ? t('settingsAccount.statusActive') : t('settingsAccount.statusNotAuthenticated')}
                        showChevron={false}
                    />
                    <Item
                        title={t('settingsAccount.anonymousId')}
                        detail={sync.anonID || t('settingsAccount.notAvailable')}
                        showChevron={false}
                        copy={!!sync.anonID}
                    />
                    <Item
                        title={t('settingsAccount.publicId')}
                        detail={sync.serverID || t('settingsAccount.notAvailable')}
                        showChevron={false}
                        copy={!!sync.serverID}
                    />
                </ItemGroup>

                <SettingsCatalogPageChildren
                    parentPageId="account"
                    router={router}
                    theme={theme}
                />

                <AccountServiceSettingsSection />

                {/* Account access / linking */}
                <ItemGroup>
                    {showAddYourPhone ? (
                        <Item
                            testID="settings-account-add-your-phone"
                            title={t('settings.addYourPhone')}
                            subtitle={t('settings.addYourPhoneSubtitle')}
                            icon={<Icon name="device-mobile" size={29} color={theme.colors.accent.blue} />}
                            onPress={() => router.push('/settings/add-phone')}
                            showChevron={false}
                        />
                    ) : null}
                    <Item
                        testID="settings-account-add-home"
                        title={t('settingsAccount.addAnotherHome')}
                        subtitle={t('settingsAccount.addAnotherHomeSubtitle')}
                        icon={<Icon name="house" size={29} color={theme.colors.accent.blue} />}
                        onPress={() => router.push(ADD_HOME_RESTORE_PATH)}
                        showChevron={false}
                    />
                    {showLinkNewDevice ? (
                        <Item
                            testID="settings-account-link-new-device"
                            title={t('settingsAccount.linkNewDevice')}
                            subtitle={isConnecting ? t('common.scanning') : t('settingsAccount.linkNewDeviceSubtitle')}
                            icon={<Icon name="qr-code" size={29} color={theme.colors.accent.blue} />}
                            onPress={connectAccount}
                            disabled={isConnecting}
                            showChevron={false}
                        />
                    ) : null}
                </ItemGroup>

                {/* Profile Section */}
                <ItemGroup title={t('settingsAccount.profile')}>
                        {displayName && (
                            <Item
                                title={t('settingsAccount.name')}
                                detail={displayName}
                                showChevron={false}
                            />
                        )}
                        {canSetUsername && (
                            <Item
                                title={t('profile.username')}
                                detail={profile.username ? `@${profile.username}` : undefined}
                                subtitle={
                                    profile.username ? undefined : t('friends.username.required')
                                }
                                onPress={saveUsername}
                                disabled={savingUsername}
                                loading={savingUsername}
                                showChevron={false}
                                icon={<Icon name="at" size={29} color={theme.colors.text.secondary} />}
                            />
                        )}
                        <ProviderIdentityItems
                            profile={profile}
                            credentials={auth.credentials}
                            applyProfile={applyProfile}
                            returnTo="/settings/account"
                        />
                </ItemGroup>

                {/* Account Settings history/restore (client-side classification-aware restore owner) */}
                <SettingsHistorySection
                    credentials={auth.credentials}
                    encryption={sync.encryption}
                />

                <ItemGroup
                    title={t('settingsAccount.privacy')}
                    footer={t('settingsAccount.privacyDescription')}
                >
                    <Item
                        title={t('settingsAccount.analytics')}
                        subtitle={analyticsOptOut ? t('settingsAccount.analyticsDisabled') : t('settingsAccount.analyticsEnabled')}
                        rightElement={
                            <Switch
                                testID="settings-account-analytics-switch"
                                value={!analyticsOptOut}
                                onValueChange={(value) => {
                                    const optOut = !value;
                                    setAnalyticsOptOut(optOut);
                                }}
                                trackColor={{
                                    false: theme.colors.switch.track.inactive,
                                    true: theme.colors.switch.track.active,
                                }}
                                thumbColor={!analyticsOptOut ? theme.colors.switch.thumb.active : theme.colors.switch.thumb.inactive}
                            />
                        }
                        showChevron={false}
                    />
                    <Item
                        title={t('settingsAccount.crashReports')}
                        subtitle={crashReportsOptOut ? t('settingsAccount.crashReportsDisabled') : t('settingsAccount.crashReportsEnabled')}
                        rightElement={
                            <Switch
                                testID="settings-account-crash-reports-switch"
                                value={!crashReportsOptOut}
                                onValueChange={(value) => {
                                    const optOut = !value;
                                    setCrashReportsOptOut(optOut);
                                }}
                                trackColor={{
                                    false: theme.colors.switch.track.inactive,
                                    true: theme.colors.switch.track.active,
                                }}
                                thumbColor={!crashReportsOptOut ? theme.colors.switch.thumb.active : theme.colors.switch.thumb.inactive}
                            />
                        }
                        showChevron={false}
                    />
                </ItemGroup>

                {/* Danger Zone */}
                <ItemGroup title={t('settingsAccount.dangerZone')}>
                    <Item
                        testID="settings-account-logout"
                        title={t('settingsAccount.logoutHome', { home: activeHomeName })}
                        subtitle={t('settingsAccount.logoutHomeSubtitle', { home: activeHomeName })}
                        icon={<Icon name="sign-out" size={29} color={theme.colors.state.danger.foreground} />}
                        destructive
                        disabled={accountDeletionPending}
                        onPress={handleLogout}
                    />
                    <Item
                        testID="settings-account-forget-all-credentials"
                        title={t('settingsAccount.forgetAllCredentials')}
                        subtitle={t('settingsAccount.forgetAllCredentialsSubtitle')}
                        icon={<Icon name="key" size={29} color={theme.colors.state.danger.foreground} />}
                        destructive
                        disabled={accountDeletionPending}
                        onPress={handleForgetAllCredentials}
                    />
                    <Item testID="settings-account-delete" title={t('settingsAccount.deleteAccount')} subtitle={t('settingsAccount.deleteAccountSubtitle')} icon={<Icon name="trash" size={29} color={theme.colors.state.danger.foreground} />} destructive disabled={accountDeletionPending} loading={accountDeletionPending} onPress={handleDeleteAccount} />
                </ItemGroup>
            </ItemList>
        </>
    );
});
