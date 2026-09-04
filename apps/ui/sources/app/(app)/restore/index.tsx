import * as React from 'react';

import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { RestoreIndexEmbedded } from '@/components/onboarding/restore/RestoreIndexEmbedded';
import { WizardModalShell } from '@/components/onboarding/ui/WizardModalShell';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { t } from '@/text';
import { promptLegacyPairingUpdateRequired } from '@/auth/pairing/legacyPairingUpdateRequired';
import { LEGACY_PAIRING_UPDATE_REQUIRED_RESTORE_ROUTE_PARAM } from '@/auth/pairing/legacyPairingUpdateRequiredRoute';
import {
    HOME_QR_ENTRY_INTENT_ROUTE_PARAM,
    parseHomeQrEntryIntentRouteParam,
} from '@/auth/pairing/homeQrEntryIntent';

export default function RestoreIndex() {
    const router = useRouter();
    const params = useLocalSearchParams<Readonly<{
        pairingLink?: string | string[];
        legacyPairingUpdateRequired?: string | string[];
        entryIntent?: string | string[];
    }>>();
    const routedEntryIntent = parseHomeQrEntryIntentRouteParam(
        params[HOME_QR_ENTRY_INTENT_ROUTE_PARAM],
    );
    const entryIntent = routedEntryIntent ?? 'enter_home';
    const routedPairingLink = Array.isArray(params.pairingLink)
        ? params.pairingLink[0] ?? null
        : params.pairingLink ?? null;
    // A plain Welcome route owns `enter_home`, but routed authority-bearing input
    // must carry its entry point's explicit closed intent.
    const initialPairingLink = routedPairingLink && routedEntryIntent
        ? routedPairingLink
        : null;
    const [navigationLocked, setNavigationLocked] = React.useState(false);
    const handleBack = React.useCallback(() => {
        if (navigationLocked) return;
        safeRouterBack({
            router,
            fallbackHref: entryIntent === 'add_home' ? '/settings/account' : '/',
        });
    }, [entryIntent, navigationLocked, router]);
    const legacyPairingUpdateRequiredParam = params[LEGACY_PAIRING_UPDATE_REQUIRED_RESTORE_ROUTE_PARAM];
    const shouldPromptLegacyPairingUpdateRequired = (
        Array.isArray(legacyPairingUpdateRequiredParam)
            ? legacyPairingUpdateRequiredParam[0]
            : legacyPairingUpdateRequiredParam
    ) === '1';
    const didPromptLegacyPairingUpdateRequiredRef = React.useRef(false);

    React.useEffect(() => {
        if (!shouldPromptLegacyPairingUpdateRequired || didPromptLegacyPairingUpdateRequiredRef.current) return;
        didPromptLegacyPairingUpdateRequiredRef.current = true;
        // Consume the secret-free marker before prompting so a reload/remount cannot
        // replay compatibility guidance. The clean restore route retains the scanner.
        router.replace('/restore');
        void (async () => {
            const action = await promptLegacyPairingUpdateRequired();
            if (action === 'cancel') handleBack();
        })();
    }, [handleBack, router, shouldPromptLegacyPairingUpdateRequired]);

    if (shouldPromptLegacyPairingUpdateRequired) {
        return <View testID="legacy-pairing-update-required-route" style={{ flex: 1 }} />;
    }

    return (
        <View
            testID="unauth-shell-route-restore"
            style={{ flex: 1 }}
        >
            <WizardModalShell
                testID="restore-wizard"
                stepIndex={1}
                stepCount={3}
                title={t(
                    entryIntent === 'add_home'
                        ? 'setupOnboarding.addHomeTitle'
                        : 'setupOnboarding.authRestoreTitle',
                )}
                subtitle={t(
                    entryIntent === 'add_home'
                        ? 'setupOnboarding.addHomeSubtitle'
                        : 'setupOnboarding.authRestoreSubtitle',
                )}
                onBack={handleBack}
                backDisabled={navigationLocked}
                showSkip={false}
            >
                <View testID="restore-route-content">
                    <RestoreIndexEmbedded
                        entryIntent={entryIntent}
                        onBack={handleBack}
                        initialPairingLink={initialPairingLink}
                        onNavigationLockChange={setNavigationLocked}
                    />
                </View>
            </WizardModalShell>
        </View>
    );
}
