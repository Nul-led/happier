import * as React from 'react';
import type { AccountSecurityGetResponseV1, TerminalPresentUserPolicy } from '@happier-dev/protocol';
import { useUnistyles } from 'react-native-unistyles';

import { SettingRow, SettingSection } from '@/components/settings/shell/SettingRow';
import { Switch } from '@/components/ui/forms/Switch';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemLoadStateRows } from '@/components/ui/lists/ItemLoadStateRows';
import { t } from '@/text';

import { createAccountSecurityActionClient, type AccountSecurityActionClient } from '@/components/settings/account/accountSecurityActionClient';
import { useAccountSecurityProjectionReader } from '@/components/settings/account/useAccountSecurityProjection';

import { API_TOKEN_SETTINGS } from './apiTokensSettings';

/**
 * "Allow approvals and account changes from the CLI and daemon" on the API Tokens page (plan 01
 * §6.1, R-CLI), the one place this switch lives. The switch
 * shows the Account's stored policy from the security projection and writes it through
 * `account.security.terminalPresentUser.set`; the stored value the server returns is what it shows
 * next. A computer's `HAPPIER_CLI_PRESENT_USER=disallowed` still wins on that computer.
 */
export const ApiTokensCliPolicySection = React.memo(function ApiTokensCliPolicySection(props: Readonly<{
    projection: AccountSecurityGetResponseV1 | null;
    loading: boolean;
    client: Pick<AccountSecurityActionClient, 'setTerminalPresentUserPolicy'>;
    onProjection: (projection: AccountSecurityGetResponseV1) => void;
}>) {
    const { theme } = useUnistyles();
    const [pending, setPending] = React.useState<TerminalPresentUserPolicy | null>(null);
    const [failed, setFailed] = React.useState(false);
    const { client, onProjection, projection } = props;

    const change = React.useCallback(async (allowed: boolean) => {
        if (!projection || pending) return;
        const policy: TerminalPresentUserPolicy = allowed ? 'allowed' : 'disallowed';
        setPending(policy);
        setFailed(false);
        try {
            const stored = await client.setTerminalPresentUserPolicy(policy);
            onProjection({ ...projection, terminalPresentUserPolicy: stored.policy });
        } catch {
            setFailed(true);
        } finally {
            setPending(null);
        }
    }, [client, onProjection, pending, projection]);

    const shown = pending ?? projection?.terminalPresentUserPolicy ?? null;

    return (
        <ItemGroup
            title={t('settingsApiTokens.cliPolicy.sectionTitle')}
            description={t('settingsApiTokens.cliPolicy.sectionDescription')}
        >
            {shown === null ? (
                props.loading ? (
                    <ItemLoadStateRows
                        testID="settings-account-cli-policy-loading"
                        state={{ kind: 'loading' }}
                        rows={1}
                        lines={2}
                        accessibilityLabel={t('settingsApiTokens.cliPolicy.title')}
                    />
                ) : (
                    <SettingRow
                        setting={API_TOKEN_SETTINGS.settings.cliApprovals}
                        testID="settings-account-cli-policy-unavailable"
                        subtitle={t('settingsApiTokens.cliPolicy.unavailable')}
                        mode="info"
                        showChevron={false}
                    />
                )
            ) : (
                <SettingRow
                    setting={API_TOKEN_SETTINGS.settings.cliApprovals}
                    testID="settings-account-cli-policy"
                    subtitle={failed ? t('settingsApiTokens.cliPolicy.saveFailed') : undefined}
                    subtitleLines={0}
                    subtitleStyle={failed ? { color: theme.colors.state.danger.foreground } : undefined}
                    subtitleTestID={failed ? 'settings-account-cli-policy-error' : undefined}
                    rightElement={(
                        <Switch
                            testID="settings-account-cli-policy-switch"
                            accessibilityLabel={t('settingsApiTokens.cliPolicy.title')}
                            value={shown === 'allowed'}
                            disabled={pending !== null}
                            onValueChange={change}
                        />
                    )}
                    showChevron={false}
                />
            )}
        </ItemGroup>
    );
});

/** The section on the API Tokens page: the active Account's security projection and its Action client. */
export const ApiTokensCliPolicy = React.memo(function ApiTokensCliPolicy() {
    const { state, publishProjection } = useAccountSecurityProjectionReader();
    const client = React.useMemo(() => createAccountSecurityActionClient(), []);
    return (
        <SettingSection section={API_TOKEN_SETTINGS.sectionRefs.cliApprovals}>
            <ApiTokensCliPolicySection
                projection={state.kind === 'ready' ? state.projection : null}
                loading={state.kind === 'loading'}
                client={client}
                onProjection={publishProjection}
            />
        </SettingSection>
    );
});
