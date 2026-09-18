import * as React from 'react';

import { Modal } from '@/modal';
import { t } from '@/text';
import { TokenStorage } from '@/auth/storage/tokenStorage';
import { renameServerProfile, resolveServerProfileScopeId, type ServerProfile } from '@/sync/domains/server/serverProfiles';
import { removeServerProfileUiAction } from '@/components/serverProfiles/removeServerProfileUiAction';
import { presentFirstKeyCredentialLifecycle } from '@/components/account/presentFirstKeyCredentialLifecycle';
import { retargetPendingTerminalConnectToServerUrl } from '@/sync/domains/pending/retargetPendingTerminalConnectToServerUrl';

import type { ServerAuthStatus } from './useServerAuthStatusByServerId';
import type { ActiveServerSwitchResult } from '@/sync/domains/server/activeServerSwitch';

export function useServerSettingsServerProfileActions(params: Readonly<{
    authStatusByServerId: Readonly<Record<string, ServerAuthStatus>>;
    selectionScope: 'device' | 'tab';
    onSwitchServerById: (serverId: string, scope?: 'device' | 'tab') => Promise<ActiveServerSwitchResult>;
    onAfterSignedOutSwitch: () => void;

    setRevision: React.Dispatch<React.SetStateAction<number>>;
}>) {
    const onSwitchServer = React.useCallback(async (profile: ServerProfile, scope: 'device' | 'tab' = params.selectionScope) => {
        const scopeId = resolveServerProfileScopeId(profile);
        let authStatus = params.authStatusByServerId[scopeId]
            ?? params.authStatusByServerId[profile.id]
            ?? 'unknown';
        if (authStatus === 'unknown') {
            try {
                const creds = await TokenStorage.getCredentialsForServerUrl(profile.serverUrl, { serverId: profile.id });
                authStatus = creds ? 'signedIn' : 'signedOut';
            } catch {
                authStatus = 'unknown';
            }
        }
        const switched =
            await params.onSwitchServerById(scopeId, scope);
        if (switched === 'blocked') return;
        retargetPendingTerminalConnectToServerUrl(profile.serverUrl);
        if (authStatus === 'signedOut') {
            params.onAfterSignedOutSwitch();
        }
        params.setRevision((r) => r + 1);
    }, [params]);

    const onRenameServer = React.useCallback(async (profile: ServerProfile) => {
        const next = await Modal.prompt(
            t('server.renameServer'),
            t('server.renameServerPrompt'),
            { defaultValue: profile.name, placeholder: t('server.serverNamePlaceholder') }
        );
        if (!next) return;
        try {
            await renameServerProfile(profile.id, next);
            params.setRevision((r) => r + 1);
        } catch (err) {
            Modal.alert(t('common.error'), String((err as any)?.message ?? err));
        }
    }, [params]);

    const onRemoveServer = React.useCallback(async (profile: ServerProfile) => {
        const confirmed = await Modal.confirm(
            t('server.removeServer'),
            t('server.removeServerConfirm', { name: profile.name }),
            { confirmText: t('common.remove'), destructive: true }
        );
        if (!confirmed) return;
        try {
            await presentFirstKeyCredentialLifecycle({
                run: async () =>
                    await removeServerProfileUiAction({
                        profileId: profile.id,
                        serverUrl: profile.serverUrl,
                    }),
                onCompleted: () => {
                    params.setRevision((r) => r + 1);
                },
            });
        } catch (err) {
            Modal.alert(t('common.error'), String((err as any)?.message ?? err));
        }
    }, [params]);

    return {
        onSwitchServer,
        onRenameServer,
        onRemoveServer,
    } as const;
}
