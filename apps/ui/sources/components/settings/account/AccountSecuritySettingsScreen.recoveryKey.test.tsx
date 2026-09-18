import * as React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';

import { AccountSecuritySettingsScreen } from './AccountSecuritySettingsScreen';

type PublishedProjection = Readonly<{
    v: 1;
    encryptionMode: 'plain' | 'e2ee';
    nativeEmail: string | null;
    password: Readonly<{ status: 'enrolled'; revision: number }> | Readonly<{ status: 'not_enrolled'; revision: null }>;
}>;

const boundary = vi.hoisted(() => ({
    credentials: { token: 'account-a' } as Record<string, unknown>,
    projection: null as PublishedProjection | null,
    read: vi.fn(),
    createClient: vi.fn(),
}));
const modal = vi.hoisted(() => ({
    alert: vi.fn(),
    show: vi.fn(() => 'modal-id'),
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ params: {} }).module;
});
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ credentials: boundary.credentials, refreshFromActiveServer: vi.fn() }),
}));
vi.mock('@/utils/auth/parseToken', () => ({ parseToken: (token: string) => token }));
vi.mock('@/hooks/server/useActiveServerSnapshot', () => ({
    useActiveServerSnapshot: () => ({ serverId: 'home-a', serverUrl: 'https://home-a.test' }),
}));
vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopeResolution: () => ({
        kind: 'bound',
        scope: { serverId: 'home-a', accountId: 'account-a' },
    }),
}));
vi.mock('@/sync/domains/scope/activeServerAccountScope', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/scope/activeServerAccountScope')>()),
    captureActiveServerAccountScopeCurrentness: () => ({
        isCurrent: () => true,
        onRetire: () => ({ dispose: () => undefined }),
    }),
}));
vi.mock('./accountSecurityActionClient', () => ({
    createAccountSecurityActionClient: boundary.createClient,
}));
vi.mock('./openAccountSecurityForHome', () => ({
    ACCOUNT_SECURITY_EMAIL_PASSWORD_CONNECT_INTENT: 'email_password_connect',
    openAccountSecurityForHome: vi.fn(async () => true),
}));
vi.mock('./AccountEmailPasswordSection', () => ({
    AccountEmailPasswordSection: (props: Readonly<{ onProjection?: (value: PublishedProjection | null) => void }>) => {
        React.useEffect(() => {
            props.onProjection?.(boundary.projection);
        }, [props]);
        return React.createElement('AccountEmailPasswordSection', { testID: 'account-security-section' });
    },
}));
vi.mock('./AccountEncryptionSettingsSection', () => ({ AccountEncryptionSettingsSection: () => null }));
vi.mock('./AccountSessionSecuritySection', () => ({ AccountSessionSecuritySection: () => null }));
vi.mock('@/components/settings/SettingsCatalogOverviewGroup', () => ({ SettingsCatalogPageChildren: () => null }));
vi.mock('@/modal', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/modal')>()),
    Modal: { alert: modal.alert, show: modal.show },
}));
vi.mock('react-native-unistyles', async () => (await import('@/dev/testkit/mocks/unistyles')).createUnistylesMock());
vi.mock('@expo/vector-icons', async () => (await import('@/dev/testkit/mocks/icons')).createExpoVectorIconsMock());

beforeEach(() => {
    boundary.credentials = { token: 'account-a' };
    boundary.projection = null;
    boundary.read.mockReset();
    // No second reader may exist for this projection: any call is a defect.
    boundary.read.mockImplementation(async () => { throw new Error('unexpected_second_projection_read'); });
    boundary.createClient.mockReset();
    boundary.createClient.mockImplementation(() => ({ read: boundary.read }));
    modal.alert.mockReset();
    modal.show.mockReset().mockReturnValue('modal-id');
});

afterEach(() => standardCleanup());

it('reads the Account Security projection exactly once through its one mounted owner', async () => {
    boundary.projection = {
        v: 1,
        encryptionMode: 'e2ee',
        nativeEmail: 'person@example.test',
        password: { status: 'enrolled', revision: 3 },
    };

    const screen = await renderScreen(<AccountSecuritySettingsScreen />);

    await vi.waitFor(() => expect(screen.findByTestId('settings-account-recovery-key')).not.toBeNull());
    expect(boundary.read).not.toHaveBeenCalled();
});

it('explains an unavailable recovery key instead of leaving the row inert', async () => {
    boundary.credentials = { token: 'account-a', encryption: { publicKey: 'pk', machineKey: 'mk' } };
    boundary.projection = {
        v: 1,
        encryptionMode: 'e2ee',
        nativeEmail: null,
        password: { status: 'not_enrolled', revision: null },
    };

    const screen = await renderScreen(<AccountSecuritySettingsScreen />);
    await vi.waitFor(() => expect(screen.findByTestId('settings-account-recovery-key')).not.toBeNull());

    await screen.pressByTestIdAsync('settings-account-recovery-key');

    expect(modal.show).not.toHaveBeenCalled();
    expect(modal.alert).toHaveBeenCalledTimes(1);
});

it('opens the recovery-key unlock host for an E2EE Account that still has a sign-in email', async () => {
    boundary.credentials = { token: 'account-a', encryption: { publicKey: 'pk', machineKey: 'mk' } };
    boundary.projection = {
        v: 1,
        encryptionMode: 'e2ee',
        nativeEmail: 'person@example.test',
        password: { status: 'enrolled', revision: 2 },
    };

    const screen = await renderScreen(<AccountSecuritySettingsScreen />);
    await vi.waitFor(() => expect(screen.findByTestId('settings-account-recovery-key')).not.toBeNull());

    await screen.pressByTestIdAsync('settings-account-recovery-key');

    expect(modal.alert).not.toHaveBeenCalled();
    expect(modal.show).toHaveBeenCalledTimes(1);
});

it('withdraws the recovery-key row when the canonical projection becomes unavailable', async () => {
    boundary.projection = null;

    const screen = await renderScreen(<AccountSecuritySettingsScreen />);
    await vi.waitFor(() => expect(screen.findByTestId('account-security-section')).not.toBeNull());

    expect(screen.findByTestId('settings-account-recovery-key')).toBeNull();
});
