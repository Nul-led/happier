import * as React from 'react';

import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';

import { RestoreIndexEmbedded } from '@/components/onboarding/restore/RestoreIndexEmbedded';
import { WizardModalShell } from '@/components/onboarding/ui/WizardModalShell';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { t } from '@/text';

export default function RestoreIndex() {
    const router = useRouter();
    const params = useLocalSearchParams<Readonly<{ pairingLink?: string | string[] }>>();
    const initialPairingLink = Array.isArray(params.pairingLink)
        ? params.pairingLink[0] ?? null
        : params.pairingLink ?? null;
    const [navigationLocked, setNavigationLocked] = React.useState(false);
    usePreventRemove(navigationLocked, () => undefined);
    const handleBack = React.useCallback(() => {
        if (navigationLocked) return;
        safeRouterBack({ router, fallbackHref: '/' });
    }, [navigationLocked, router]);

    return (
        <View
            testID="unauth-shell-route-restore"
            style={{ flex: 1 }}
        >
            <WizardModalShell
                testID="restore-wizard"
                stepIndex={1}
                stepCount={3}
                title={t('setupOnboarding.authRestoreTitle')}
                subtitle={t('setupOnboarding.authRestoreSubtitle')}
                onBack={handleBack}
                backDisabled={navigationLocked}
                showSkip={false}
            >
                <View testID="restore-route-content">
                    <RestoreIndexEmbedded
                        onBack={handleBack}
                        initialPairingLink={initialPairingLink}
                        onNavigationLockChange={setNavigationLocked}
                    />
                </View>
            </WizardModalShell>
        </View>
    );
}
