import React from 'react';
import { useRouter } from 'expo-router';
import { useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/context/AuthContext';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Icon } from '@/components/ui/icons/Icon';
import { Modal } from '@/modal';
import { t } from '@/text';
import { createApiTokenSettingsController } from '@/components/settings/apiTokens/apiTokenSettingsController';
import { useApiTokenSettingsControllerState } from '@/components/settings/apiTokens/useApiTokenSettingsControllerState';
import { completeApiTokenSettingsSignOutEverywhere } from '@/components/settings/apiTokens/apiTokenSettingsSignOutLifecycle';
import { resolveApiTokenOperationErrorMessageKey } from '@/components/settings/apiTokens/apiTokenSettingsPresentation';
import { captureActiveServerAccountScopeCurrentness } from '@/sync/domains/scope/activeServerAccountScope';

export const AccountSessionSecuritySection = React.memo(function AccountSessionSecuritySection() {
    const auth = useAuth();
    const router = useRouter();
    const { theme } = useUnistyles();
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
        <ItemGroup>
            <Item
                testID="settings-account-sign-out-everywhere"
                title={t('settingsApiTokens.signOutEverywhere.title')}
                subtitle={t('settingsApiTokens.signOutEverywhere.subtitle')}
                icon={<Icon name="sign-out" size={24} color={theme.colors.state.danger.foreground} />}
                destructive
                disabled={!auth.credentials || state.operation !== null}
                loading={state.operation === 'signOutEverywhere'}
                onPress={signOut}
            />
        </ItemGroup>
    );
});
