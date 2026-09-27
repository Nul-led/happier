import React from 'react';
import { useRouter } from 'expo-router';

import { useAuth } from '@/auth/context/AuthContext';
import { Item } from '@/components/ui/lists/Item';
import { SettingAnchor } from '@/components/settings/shell/SettingRow';
import { ACCOUNT_SECURITY_SETTINGS } from './accountSecuritySettings';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Modal } from '@/modal';
import { t } from '@/text';
import { createApiTokenSettingsController } from '@/components/settings/apiTokens/apiTokenSettingsController';
import { useApiTokenSettingsControllerState } from '@/components/settings/apiTokens/useApiTokenSettingsControllerState';
import { completeApiTokenSettingsSignOutEverywhere } from '@/components/settings/apiTokens/apiTokenSettingsSignOutLifecycle';
import { resolveApiTokenOperationErrorMessageKey } from '@/components/settings/apiTokens/apiTokenSettingsPresentation';
import { captureActiveServerAccountScopeCurrentness } from '@/sync/domains/scope/activeServerAccountScope';

/** Ends every signed-in session for this Account. A row, so it can sit in any section. */
export const AccountSignOutEverywhereItem = React.memo(function AccountSignOutEverywhereItem(props: Readonly<{ showDivider?: boolean }>) {
    const auth = useAuth();
    const router = useRouter();
    const [controller] = React.useState(createApiTokenSettingsController);
    const state = useApiTokenSettingsControllerState(controller);
    React.useInsertionEffect(() => () => controller.retire(), [controller]);

    const signOut = async () => {
        const accountCurrentness = captureActiveServerAccountScopeCurrentness();
        const confirmed = await Modal.confirm(
            t('settingsApiTokens.signOutEverywhere.title'),
            t('settingsApiTokens.signOutEverywhere.body'),
            { cancelText: t('common.cancel'), confirmText: t('settingsApiTokens.signOutEverywhere.confirm'), destructive: true },
        );
        if (!confirmed || !accountCurrentness.isCurrent()) return;
        const completed = await completeApiTokenSettingsSignOutEverywhere({
            signOutEverywhere: controller.signOutEverywhere,
            logout: auth.logout,
            replace: (path) => router.replace(path),
        });
        if (!completed && controller.getState().operationError) {
            await Modal.alertAsync(t('common.error'), t(resolveApiTokenOperationErrorMessageKey(controller.getState().operationError)));
        }
    };

    return (
        <SettingAnchor setting={ACCOUNT_SECURITY_SETTINGS.settings.signOutEverywhere} showDivider={props.showDivider}>
        <Item
            testID="settings-account-sign-out-everywhere"
            title={t('settingsApiTokens.signOutEverywhere.title')}
            subtitle={t('settingsApiTokens.signOutEverywhere.subtitle')}
            destructive
            disabled={!auth.credentials || state.operation !== null}
            loading={state.operation === 'signOutEverywhere'}
            onPress={signOut}
            showChevron={false}
            showDivider={props.showDivider}
        />
        </SettingAnchor>
    );
});

export const AccountSessionSecuritySection = React.memo(function AccountSessionSecuritySection() {
    return (
        <ItemGroup title={t('settingsAccount.sessionsSectionTitle')}>
            <AccountSignOutEverywhereItem />
        </ItemGroup>
    );
});
