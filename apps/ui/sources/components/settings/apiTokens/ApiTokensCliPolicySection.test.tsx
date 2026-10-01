import React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountSecurityGetResponseV1, ActionExecuteResult } from '@happier-dev/protocol';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';
import { createAccountSecurityActionClient } from '../account/accountSecurityActionClient';

installSettingsViewCommonModuleMocks({});

const PROJECTION: AccountSecurityGetResponseV1 = {
    v: 1,
    encryptionMode: 'plain',
    terminalPresentUserPolicy: 'allowed',
    nativeEmail: null,
    password: { status: 'not_enrolled', revision: null },
};

afterEach(() => standardCleanup());

describe('ApiTokensCliPolicySection', () => {
    it('sends the chosen policy through its Action and then shows the value the server stored', async () => {
        // The Action front door is the transport boundary; the real client parses its result.
        const execute = vi.fn(async (): Promise<ActionExecuteResult> => ({ ok: true, result: { policy: 'disallowed' } }));
        const client = createAccountSecurityActionClient({ execute, resolveServerId: () => 'server-a' });
        const onProjection = vi.fn();
        const { ApiTokensCliPolicySection } = await import('./ApiTokensCliPolicySection');
        const screen = await renderScreen(
            <ApiTokensCliPolicySection projection={PROJECTION} loading={false} client={client} onProjection={onProjection} />,
        );
        const toggle = screen.findByTestId('settings-account-cli-policy-switch');
        expect(toggle?.props.value).toBe(true);

        await act(async () => { await toggle!.props.onValueChange(false); });

        expect(execute).toHaveBeenCalledWith(
            'account.security.terminalPresentUser.set',
            { policy: 'disallowed' },
            expect.objectContaining({ surface: 'ui', actionCaller: { kind: 'host' } }),
        );
        expect(onProjection).toHaveBeenCalledWith({ ...PROJECTION, terminalPresentUserPolicy: 'disallowed' });
    });

    it('returns to the stored value and says so when the change fails', async () => {
        const execute = vi.fn(async (): Promise<ActionExecuteResult> => ({ ok: false, errorCode: 'network_error', error: 'network_error' }));
        const client = createAccountSecurityActionClient({ execute, resolveServerId: () => 'server-a' });
        const onProjection = vi.fn();
        const { ApiTokensCliPolicySection } = await import('./ApiTokensCliPolicySection');
        const screen = await renderScreen(
            <ApiTokensCliPolicySection projection={PROJECTION} loading={false} client={client} onProjection={onProjection} />,
        );

        await act(async () => { await screen.findByTestId('settings-account-cli-policy-switch')!.props.onValueChange(false); });

        expect(onProjection).not.toHaveBeenCalled();
        expect(screen.findByTestId('settings-account-cli-policy-switch')?.props.value).toBe(true);
        expect(screen.findByTestId('settings-account-cli-policy-error')).toBeTruthy();
    });
});
