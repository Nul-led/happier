import React from 'react';
import { Pressable } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/context/AuthContext';
import { isLegacyAuthCredentials, TokenStorage } from '@/auth/storage/tokenStorage';
import { SecretKeyBackupModal } from '@/components/account/SecretKeyBackupModal';
import { RecoveryKeyUnlockModal } from '@/components/account/RecoveryKeyUnlockModal';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Icon } from '@/components/ui/icons/Icon';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { SettingsCatalogPageChildren } from '@/components/settings/SettingsCatalogOverviewGroup';
import { Modal } from '@/modal';
import type { AccountSecurityGetResponseV1 } from '@happier-dev/protocol';
import { t } from '@/text';
import { AccountEmailPasswordSection } from './AccountEmailPasswordSection';
import { AccountEncryptionSettingsSection } from './AccountEncryptionSettingsSection';
import { AccountSessionSecuritySection } from './AccountSessionSecuritySection';
import { createAccountSecurityActionClient } from './accountSecurityActionClient';
import { captureActiveServerAccountScopeCurrentness } from '@/sync/domains/scope/activeServerAccountScope';
import { serverFetch } from '@/sync/http/client';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { parseToken } from '@/utils/auth/parseToken';
import {
    ACCOUNT_SECURITY_EMAIL_PASSWORD_CONNECT_INTENT,
    openAccountSecurityForHome,
} from './openAccountSecurityForHome';

export const AccountSecuritySettingsScreen = React.memo(function AccountSecuritySettingsScreen() {
    const auth = useAuth();
    const router = useRouter();
    const params = useLocalSearchParams<{
        verificationToken?: string | string[];
        serverId?: string | string[];
        intent?: string | string[];
    }>();
    const verificationToken = Array.isArray(params.verificationToken)
        ? params.verificationToken[0] ?? null
        : params.verificationToken ?? null;
    const routeServerId = Array.isArray(params.serverId)
        ? params.serverId[0] ?? null
        : params.serverId ?? null;
    const routeIntent = Array.isArray(params.intent)
        ? params.intent[0] ?? null
        : params.intent ?? null;
    const connectIntent = routeIntent === ACCOUNT_SECURITY_EMAIL_PASSWORD_CONNECT_INTENT;
    const activeServer = useActiveServerSnapshot();
    const routeTargetsActiveHome = routeServerId === null
        || areServerProfileIdentifiersEquivalent(routeServerId, activeServer.serverId);
    const targetAccountScope = useServerCredentialAccountScopeResolution(
        routeServerId ?? activeServer.serverId,
    );
    const authenticatedAccountId = auth.credentials ? parseToken(auth.credentials.token) : null;
    const routeTargetsActiveAccount = targetAccountScope.kind === 'bound'
        && targetAccountScope.scope.accountId === authenticatedAccountId;
    const { theme } = useUnistyles();
    const recoveryKeyTriggerRef = React.useRef<React.ComponentRef<typeof Pressable> | null>(null);
    const securityClient = React.useMemo(() => createAccountSecurityActionClient({
        resolveServerId: () => routeServerId ?? activeServer.serverId,
    }), [activeServer.serverId, routeServerId]);
    // One reader owns this projection: the mounted email/password section
    // publishes what it already read, so this route never issues a competing
    // Account Security request or drifts from the section's retry state.
    const [projection, setProjection] = React.useState<AccountSecurityGetResponseV1 | null>(null);
    const recoveryEmail = projection?.nativeEmail ?? null;
    const recoveryApplicable = projection?.encryptionMode === 'e2ee';
    const secret = auth.credentials && isLegacyAuthCredentials(auth.credentials) ? auth.credentials.secret : null;
    const targetServerId = routeServerId ?? activeServer.serverId;
    const targetKey = `${targetServerId}\u0000${routeIntent ?? ''}\u0000${verificationToken ?? ''}`;
    const [switchAttempt, setSwitchAttempt] = React.useState(0);
    const [switchState, setSwitchState] = React.useState<Readonly<{
        targetKey: string | null;
        status: 'switching' | 'failed';
    }>>({ targetKey: null, status: 'switching' });

    React.useEffect(() => {
        if (routeTargetsActiveHome && routeTargetsActiveAccount) return;
        if (routeServerId === null || (routeTargetsActiveHome && targetAccountScope.kind === 'resolving')) return;

        let current = true;
        setSwitchState((currentState) => (
            currentState.targetKey === targetKey && currentState.status === 'switching'
                ? currentState
                : { targetKey, status: 'switching' }
        ));
        void openAccountSecurityForHome({
            serverId: targetServerId,
            router,
            refreshAuth: auth.refreshFromActiveServer,
            ...(connectIntent ? { intent: ACCOUNT_SECURITY_EMAIL_PASSWORD_CONNECT_INTENT } : {}),
            ...(verificationToken ? { verificationToken } : {}),
        }).then((opened) => {
            if (current && !opened) setSwitchState({ targetKey, status: 'failed' });
        }).catch(() => {
            if (current) setSwitchState({ targetKey, status: 'failed' });
        });
        return () => { current = false; };
    }, [auth.refreshFromActiveServer, connectIntent, routeServerId, routeTargetsActiveAccount, routeTargetsActiveHome, router, switchAttempt, targetAccountScope.kind, targetKey, targetServerId, verificationToken]);

    const retryExactHome = React.useCallback(() => {
        setSwitchState({ targetKey, status: 'switching' });
        setSwitchAttempt((attempt) => attempt + 1);
    }, [targetKey]);

    const showDisclosure = React.useCallback((value: string | Uint8Array) => {
        Modal.show({
            component: SecretKeyBackupModal,
            props: {
                secret: value,
                onSaved: async () => { await TokenStorage.setRecoveryKeyReminderDismissed(true); },
            },
            focusReturnRef: recoveryKeyTriggerRef,
        });
    }, []);

    const openRecoveryKey = React.useCallback(() => {
        if (secret) {
            showDisclosure(secret);
            return;
        }
        if (!recoveryEmail) {
            // No local recovery secret and no native sign-in email means there is
            // no password envelope to open here. Say so instead of leaving an
            // inert row: the key must come from a device that already holds it.
            Modal.alert(t('settingsAccount.secretKey'), t('settingsAccount.secretKeyMissing'));
            return;
        }
        const lifetime = captureActiveServerAccountScopeCurrentness();
        const controller = new AbortController();
        const retirement = lifetime.onRetire(() => controller.abort());
        const request = async (...args: Parameters<typeof serverFetch>) => {
            if (!lifetime.isCurrent() || controller.signal.aborted) throw new Error('action_account_scope_changed');
            const [path, init, options] = args;
            const response = await serverFetch(path, { ...init, signal: controller.signal }, options);
            if (!lifetime.isCurrent() || controller.signal.aborted) throw new Error('action_account_scope_changed');
            return response;
        };
        Modal.show({
            component: RecoveryKeyUnlockModal,
            props: {
                email: recoveryEmail,
                request,
                onUnlocked: async (recovered) => showDisclosure(recovered.slice()),
            },
            focusReturnRef: recoveryKeyTriggerRef,
            onHostUnmount: () => {
                controller.abort();
                retirement.dispose();
            },
        });
    }, [recoveryEmail, secret, showDisclosure]);

    // A mailbox bearer addressed to Home A must never reach Home B while the
    // explicit focus handoff is still publishing. Mounting no Account Security
    // consumers here also aborts the previous Home's scoped preparation work.
    if (!routeTargetsActiveHome || !routeTargetsActiveAccount) {
        const currentSwitchStatus = switchState.targetKey === targetKey
            ? switchState.status
            : 'switching';
        if (currentSwitchStatus === 'failed') {
            return (
                <SurfaceStateCard
                    testID="settings-account-security-home-switch-failed"
                    kind="unavailable"
                    title={t('errors.operationFailed')}
                    reason={t('settingsAccount.accountServiceDiscoveryUnavailableDescription')}
                    action={{ label: t('common.retry'), onPress: retryExactHome }}
                    secondaryAction={{ label: t('common.back'), onPress: router.back }}
                    accessibilitySemantics="alert"
                />
            );
        }
        return (
            <SurfaceStateCard
                testID="settings-account-security-home-switching"
                kind="loading"
                title={t('common.loading')}
                accessibilitySemantics="status"
            />
        );
    }

    return (
        <ItemList>
            <AccountEmailPasswordSection
                client={securityClient}
                verificationToken={verificationToken}
                connectIntent={connectIntent}
                onProjection={setProjection}
            />
            {recoveryApplicable ? (
                <ItemGroup title={t('settingsAccount.backup')}>
                    <Item
                        testID="settings-account-recovery-key"
                        title={t('settingsAccount.secretKey')}
                        subtitle={t('settingsAccount.backupDescription')}
                        pressableRef={recoveryKeyTriggerRef}
                        icon={<Icon name="key" size={24} color={theme.colors.accent.orange} />}
                        onPress={openRecoveryKey}
                    />
                </ItemGroup>
            ) : null}
            <AccountSessionSecuritySection />
            <SettingsCatalogPageChildren parentPageId="accountSecurity" router={router} theme={theme} />
            <AccountEncryptionSettingsSection />
        </ItemList>
    );
});
