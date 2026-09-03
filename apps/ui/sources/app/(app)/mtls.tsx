import * as React from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/auth/context/AuthContext';
import { createServerFetchAtEndpoint } from '@/sync/http/client';
import { Modal } from '@/modal';
import { t } from '@/text';
import { formatOperationFailedDebugMessage } from '@/utils/errors/formatOperationFailedDebugMessage';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import {
    presentFirstKeyCredentialLifecycle,
} from '@/components/account/presentFirstKeyCredentialLifecycle';

export default function MtlsCallbackScreen() {
    const auth = useAuth();
    const params = useLocalSearchParams();

    React.useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const error = typeof (params as any)?.error === 'string' ? String((params as any).error).trim().toLowerCase() : '';
                if (error === 'restore_required') {
                    router.replace('/restore');
                    return;
                }

                const code = typeof params.code === 'string' ? params.code : '';
                if (!code.trim()) {
                    await Modal.alert(t('common.error'), t('errors.operationFailed'));
                    router.replace('/');
                    return;
                }

                const pendingState = await TokenStorage.readPendingExternalAuthContinuationState();
                const pending = pendingState.value;
                const serverId = String(pending?.serverId ?? '').trim();
                const serverUrl = String(pending?.serverUrl ?? '').trim().replace(/\/+$/, '');
                if (pendingState.serverMismatch || pending?.provider !== 'mtls' || !serverId || !serverUrl) {
                    await Modal.alert(t('common.error'), t('errors.operationFailed'));
                    router.replace('/');
                    return;
                }
                const target = { serverId, serverUrl };
                const requestAtTarget = createServerFetchAtEndpoint({ endpointUrl: serverUrl, serverId });

                const controller = new AbortController();
                const timeoutMs = 15000;
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const res = await requestAtTarget(
                        '/v1/auth/mtls/claim',
                        {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ code }),
                            signal: controller.signal,
                        },
                        { includeAuth: false },
                    );
                    const json = await res.json().catch(() => null);
                    if (!res.ok || !json || typeof json.token !== 'string') {
                        await Modal.alert(t('common.error'), t('errors.operationFailed'));
                        router.replace('/');
                        return;
                    }

                    const token = String(json.token);
                    const finishCredentialCustody = async () => {
                        await TokenStorage.clearPendingExternalAuth(target);
                        if (!mounted) return;
                        router.replace('/');
                    };
                    await presentFirstKeyCredentialLifecycle({
                        run: async () =>
                            await auth.loginWithCredentials({ token }, { target }),
                        onCompleted: finishCredentialCustody,
                        onFinishCompleted: finishCredentialCustody,
                    });
                } finally {
                    clearTimeout(timer);
                }
            } catch (error) {
                const message = process.env.EXPO_PUBLIC_DEBUG
                    ? formatOperationFailedDebugMessage(t('errors.operationFailed'), error)
                    : t('errors.operationFailed');
                await Modal.alert(t('common.error'), message);
                router.replace('/');
            }
        })();
        return () => {
            mounted = false;
        };
    }, [auth, params.code]);

    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivitySpinner />
        </View>
    );
}
