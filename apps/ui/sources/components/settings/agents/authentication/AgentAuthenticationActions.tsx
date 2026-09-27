import * as React from 'react';

import { Item } from '@/components/ui/lists/Item';
import { t } from '@/text';

export const AgentAuthenticationActions = React.memo(function AgentAuthenticationActions(props: Readonly<{
    canCheckNow: boolean;
    canLaunchLogin: boolean;
    loginActionKind: 'login' | 'reauthenticate';
    docsUrl?: string | null;
    onCheckNow: () => void;
    onLaunchLogin: () => void;
}>) {
    return (
        <>
            {props.canLaunchLogin ? (
                <Item
                    testID="settings-provider-auth-login"
                    title={props.loginActionKind === 'reauthenticate'
                        ? t('settingsAgents.authentication.reauthenticateTitle')
                        : t('settingsAgents.authentication.logInTitle')}
                    subtitle={props.loginActionKind === 'reauthenticate'
                        ? t('settingsAgents.authentication.reauthenticateSubtitle')
                        : t('settingsAgents.authentication.logInSubtitle')}
                    onPress={props.onLaunchLogin}
                />
            ) : null}
            {props.canCheckNow ? (
                <Item
                    testID="settings-provider-auth-check-now"
                    title={t('settingsAgents.authentication.checkNowTitle')}
                    subtitle={t('settingsAgents.authentication.checkNowSubtitle')}
                    onPress={props.onCheckNow}
                />
            ) : null}
            {props.docsUrl ? (
                <Item
                    testID="settings-provider-auth-docs-url"
                    title={t('settingsAgents.setupGuideUrlTitle')}
                    subtitle={props.docsUrl}
                    mode="info"
                    copy={props.docsUrl}
                />
            ) : null}
        </>
    );
});
