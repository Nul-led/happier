import * as React from 'react';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { RestoreQrView } from '@/components/account/restore/RestoreQrView';
import { HOME_QR_ENTRY_INTENT_ROUTE_PARAM, parseHomeQrEntryIntentRouteParam } from '@/auth/pairing/homeQrEntryIntent';
import { UnauthenticatedSplitShell } from '@/components/onboarding/unauthShell';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';

const ignoreBrandHeroGetStarted = () => undefined;

export default function RestoreShowQrRoute() {
    const router = useRouter();
    const params = useLocalSearchParams<{ serverId?: string | string[]; entryIntent?: string | string[] }>();
    const rawServerId = Array.isArray(params.serverId) ? params.serverId[0] : params.serverId;
    const targetProfileId = typeof rawServerId === 'string' ? rawServerId.trim() : '';
    const entryIntent = parseHomeQrEntryIntentRouteParam(params[HOME_QR_ENTRY_INTENT_ROUTE_PARAM]) ?? 'enter_home';
    const handleBack = React.useCallback(() => {
        safeRouterBack({ router, fallbackHref: '/restore' });
    }, [router]);
    const handleOpenRelayCustomFlow = React.useCallback(() => {
        router.push('/');
    }, [router]);

    return (
        <UnauthenticatedSplitShell
            stepId="restore-show-qr"
            isWelcomeStep={false}
            allowMobileBrandHero={false}
            onOpenRelayCustomFlow={handleOpenRelayCustomFlow}
            onBrandHeroGetStarted={ignoreBrandHeroGetStarted}
            onBack={handleBack}
            testID="unauth-shell-route-restore-show-qr"
        >
            <View testID="restore-route-content" style={styles.content}>
                {targetProfileId ? (
                    <RestoreQrView
                        entryIntent={entryIntent}
                        targetProfileId={targetProfileId}
                        embedded
                        onBack={handleBack}
                    />
                ) : null}
            </View>
        </UnauthenticatedSplitShell>
    );
}

const styles = StyleSheet.create(() => ({
    content: {
        flex: 1,
        width: '100%',
    },
}));
