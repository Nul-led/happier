import * as React from 'react';
import { useNavigation, useRouter } from 'expo-router';

import { WizardModalShell } from '@/components/onboarding/ui/WizardModalShell';
import { ScanAuthQrScreen } from '@/components/qr/ScanAuthQrScreen';
import { t } from '@/text';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';

export default function ScanTerminalQrScreen() {
    const router = useRouter();
    const navigation = useNavigation();
    const handleBack = React.useCallback(() => {
        safeRouterBack({ router, navigation, fallbackHref: '/' });
    }, [navigation, router]);

    return (
        <WizardModalShell
            testID="scan-terminal-wizard"
            stepIndex={0}
            stepCount={1}
            title={t('modals.authenticateTerminal')}
            subtitle={t('connect.scanQrCodeOnDevice')}
            onBack={handleBack}
            showSkip={false}
        >
            <ScanAuthQrScreen
                allowedUrlKind="terminal"
                fallbackHref="/"
                testIDPrefix="scan-terminal"
                title={t('modals.authenticateTerminal')}
                subtitle={t('connect.scanQrCodeOnDevice')}
                permissionRequiredMessage={t('modals.cameraPermissionsRequiredToConnectTerminal')}
                manualEntryTitle={t('modals.authenticateTerminal')}
                manualEntryDescription={t('modals.pasteUrlFromTerminal')}
                manualEntryPlaceholder={t('connect.terminalUrlPlaceholder')}
                manualEntrySubmitText={t('common.authenticate')}
            />
        </WizardModalShell>
    );
}
