import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { useUnistyles } from 'react-native-unistyles';

import { useAuth } from '@/auth/context/AuthContext';
import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import {
    fetchAccountEncryptionMode,
    getAccountEncryptionModeCacheRevision,
    getCachedAccountEncryptionMode,
    subscribeAccountEncryptionModeCacheInvalidation,
} from '@/sync/api/account/apiAccountEncryptionMode';
import { t } from '@/text';

/**
 * How the Account's data is protected, leading to Security. The mode is one server read through
 * its cache owner (never a machine), re-read when that owner invalidates it; the section is absent
 * until it is known, and keeps the last answer while mounted. The recovery key still to save is the
 * setup section's step, so it is not repeated here.
 */
export const HubSecuritySection = React.memo(function HubSecuritySection() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const credentials = useAuth().credentials;
    const revision = React.useSyncExternalStore(
        subscribeAccountEncryptionModeCacheInvalidation,
        getAccountEncryptionModeCacheRevision,
        getAccountEncryptionModeCacheRevision,
    );
    const [mode, setMode] = React.useState<'e2ee' | 'plain' | null>(
        () => (credentials ? getCachedAccountEncryptionMode(credentials) : null),
    );

    React.useEffect(() => {
        if (!credentials) {
            setMode(null);
            return undefined;
        }
        let current = true;
        void fetchAccountEncryptionMode(credentials).then(
            (result) => { if (current) setMode(result.mode); },
            // Not answered (offline, unreachable Home): the mode stays unknown and the section absent
            // until the next read; nothing waits on it.
            () => undefined,
        );
        return () => {
            current = false;
        };
    }, [credentials, revision]);

    if (mode !== 'e2ee' && mode !== 'plain') return null;
    return (
        <ItemGroup title={t('settingsOverview.securityTitle')}>
            <Item
                testID="hub-security"
                title={mode === 'e2ee' ? t('settingsAccount.endToEndEncrypted') : t('settingsAccount.notEndToEndEncrypted')}
                icon={<Icon name="shield-check" color={theme.colors.text.secondary} />}
                onPress={() => router.push(SETTINGS_ROUTES.accountSecurity as never)}
            />
        </ItemGroup>
    );
});
