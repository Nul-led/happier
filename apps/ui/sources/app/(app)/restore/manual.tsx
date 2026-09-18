import React from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { t } from '@/text';
import { StyleSheet } from 'react-native-unistyles';
import { WizardModalShell } from '@/components/onboarding/ui/WizardModalShell';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { SecretKeyLoginForm } from '@/components/account/restore/SecretKeyLoginForm';
import { normalizeInternalReturnPath } from '@/utils/path/routeUtils';
import { resolveHomeAuthenticationTarget } from '@/auth/flows/resolveHomeAuthenticationTarget';
import { Text } from '@/components/ui/text/Text';
import { useAuth } from '@/auth/context/AuthContext';
import { setActiveServerAndSwitch } from '@/sync/domains/server/activeServerSwitch';
import { createServerUrlComparableKey } from '@/sync/domains/server/url/serverUrlCanonical';


const stylesheet = StyleSheet.create((theme) => ({
    body: { paddingHorizontal: 24 },
}));

export default function Restore() {
    const styles = stylesheet;
    const router = useRouter();
    const auth = useAuth();
    const params = useLocalSearchParams<{
        returnTo?: string | string[];
        resumeCreate?: string | string[];
        label?: string | string[];
        expiry?: string | string[];
        targetServerId?: string | string[];
        targetServerUrl?: string | string[];
        expectedAccountId?: string | string[];
    }>();
    const rawReturnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
    const returnTo = normalizeInternalReturnPath(rawReturnTo) ?? null;
    const resumeCreate = (Array.isArray(params.resumeCreate) ? params.resumeCreate[0] : params.resumeCreate) === '1';
    const label = String(Array.isArray(params.label) ? params.label[0] ?? '' : params.label ?? '').slice(0, 256);
    const expiryRaw = Array.isArray(params.expiry) ? params.expiry[0] : params.expiry;
    const expiry = expiryRaw === '30d' || expiryRaw === '90d' || expiryRaw === '1y' || expiryRaw === 'none'
        ? expiryRaw : '90d';
    const targetServerId = String(Array.isArray(params.targetServerId)
        ? params.targetServerId[0] ?? ''
        : params.targetServerId ?? '').trim();
    const expectedAccountId = String(Array.isArray(params.expectedAccountId)
        ? params.expectedAccountId[0] ?? ''
        : params.expectedAccountId ?? '').trim();
    const targetServerUrl = String(Array.isArray(params.targetServerUrl)
        ? params.targetServerUrl[0] ?? ''
        : params.targetServerUrl ?? '').trim();
    const hasExactTargetRequest = targetServerId.length > 0
        || targetServerUrl.length > 0
        || expectedAccountId.length > 0;
    const resolvedTarget = targetServerId && targetServerUrl && expectedAccountId
        ? resolveHomeAuthenticationTarget({ kind: 'saved_profile', profileRef: targetServerId })
        : null;
    const exactTarget = resolvedTarget
        && createServerUrlComparableKey(resolvedTarget.canonicalServerUrl) === createServerUrlComparableKey(targetServerUrl)
        ? resolvedTarget
        : null;
    const completedReturnTo = returnTo === '/settings/account/api-tokens' && resumeCreate
        && exactTarget
        ? `${returnTo}?resumeCreate=1&label=${encodeURIComponent(label)}&expiry=${expiry}&targetServerId=${encodeURIComponent(targetServerId)}&targetServerUrl=${encodeURIComponent(targetServerUrl)}&expectedAccountId=${encodeURIComponent(expectedAccountId)}`
        : returnTo;

    return (
        <WizardModalShell
            testID="restore-manual-wizard"
            stepIndex={1}
            stepCount={3}
            title={t('setupOnboarding.authRestoreTitle')}
            subtitle={t('setupOnboarding.authRestoreSubtitle')}
            onBack={() => safeRouterBack({ router, fallbackHref: '/restore' })}
            showSkip={false}
        >
            <View style={styles.body}>
                {hasExactTargetRequest ? exactTarget ? (
                    <SecretKeyLoginForm
                        target={{ ...exactTarget, expectedAccountId, requireKeyChallengeV2: true }}
                        onAuthenticated={async () => {
                            const switched = await setActiveServerAndSwitch({
                                serverId: exactTarget.serverId,
                                scope: 'device',
                                refreshAuth: auth.refreshFromActiveServer,
                            });
                            if (switched !== 'blocked' && completedReturnTo) router.replace(completedReturnTo);
                        }}
                    />
                ) : (
                    <Text testID="restore-manual-target-unavailable" accessibilityRole="alert">
                        {t('settingsAccount.nativePassword.serverUnavailable')}
                    </Text>
                ) : (
                    <SecretKeyLoginForm onSuccess={completedReturnTo ? () => router.replace(completedReturnTo) : undefined} />
                )}
            </View>
        </WizardModalShell>
    );
}
