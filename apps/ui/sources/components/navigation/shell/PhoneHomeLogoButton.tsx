import * as React from 'react';
import { Pressable } from 'react-native';
import { useRouter } from 'expo-router';

import { HeaderLogo } from '@/components/ui/navigation/HeaderLogo';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

/**
 * The Happier mark in the phone's main-tab header. As the desktop logo does, it opens Home — on a
 * phone a pushed page, since the tabs stay Sessions · Inbox · Projects · Settings.
 */
export const PhoneHomeLogoButton = React.memo(function PhoneHomeLogoButton() {
    const router = useRouter();
    const openHome = React.useCallback(() => {
        const result = runGuardedNavigation(() => router.push('/home'));
        if (result !== true) fireAndForget(result, { tag: 'PhoneHomeLogoButton.home' });
    }, [router]);
    return (
        <Pressable
            testID="main-header-home-logo"
            accessibilityRole="button"
            accessibilityLabel={t('common.home')}
            hitSlop={8}
            onPress={openHome}
        >
            <HeaderLogo />
        </Pressable>
    );
});
