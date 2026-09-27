import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { createUseSettingMutableMockFromReader } from '@/dev/testkit/mocks/storage';
import { profileDefaults, type Profile } from '@/sync/domains/profiles/profile';
import {
    installSessionSettingsEntryModuleMocks,
    resetSessionSettingsEntryState,
} from './sessionSettingsEntryTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const boundary = vi.hoisted(() => ({
    // A signed credential whose subject is the Account ID on this Home.
    token: `header.${btoa(JSON.stringify({ sub: 'acct_7f3c9e21' }))}.signature`,
    clipboard: [] as string[],
    profile: null as unknown as Profile,
    encryptionMode: 'plain' as 'plain' | 'e2ee',
    holdSecurityRead: false,
    executedActionIds: [] as string[],
}));

installSessionSettingsEntryModuleMocks({
    storageModule: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSettingMutable: createUseSettingMutableMockFromReader(() => [false, vi.fn()]),
                useProfile: () => boundary.profile,
            },
        });
    },
});

// The Account Security projection crosses the remote Action transport; the real
// Account Security client and the Account page run above it.
vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({
    createFrontDoorActionExecute: () => async (actionId: string) => {
        boundary.executedActionIds.push(actionId);
        // The Home has not answered yet.
        if (boundary.holdSecurityRead) return await new Promise<never>(() => {});
        return {
            ok: true,
            result: {
                v: 1,
                encryptionMode: boundary.encryptionMode,
                nativeEmail: 'lee@example.test',
                password: { status: 'enrolled', revision: 1 },
            },
        };
    },
}));

// Legacy credentials that hold a local secret: key presence must not decide
// whether the page claims end-to-end encryption.
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        credentials: { token: boundary.token, secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
        logout: vi.fn(),
    }),
}));

vi.mock('@/hooks/auth/useConnectAccount', () => ({
    useConnectAccount: () => ({ connectAccount: vi.fn(), isLoading: false }),
}));

vi.mock('@/sync/sync', () => ({
    sync: { anonID: 'anon', serverID: 'server' },
}));

vi.mock('expo-image', () => ({ Image: 'Image' }));

vi.mock('expo-clipboard', () => ({
    setStringAsync: async (value: string) => { boundary.clipboard.push(value); },
}));

vi.mock('@/components/ui/avatar/Avatar', () => ({
    Avatar: (props: Record<string, unknown>) => React.createElement('Avatar', props),
}));

// Sibling sections that start their own network work on mount are outside the
// identity-header contract; keep the rendered tree bounded to the rows under test.
vi.mock('@/components/account/ProviderIdentityItems', () => ({ ProviderIdentityItems: () => null }));
vi.mock('@/components/settings/account/AccountServiceSettingsSection', () => ({ AccountServiceSettingsSection: () => null }));
vi.mock('@/components/settings/account/SettingsHistorySection', () => ({ SettingsHistorySection: () => null }));

async function renderAccount() {
    vi.resetModules();
    const { default: AccountScreen } = await import('@/app/(app)/settings/account');
    const screen = await renderScreen(<AccountScreen />);
    await vi.waitFor(() => expect(boundary.executedActionIds).toContain('account.security.get'));
    return screen;
}

type RenderedNode = Readonly<{ children: readonly (RenderedNode | string)[]; props: Record<string, unknown> }>;

function renderedText(node: RenderedNode | string | null | undefined): string {
    if (node == null) return '';
    if (typeof node === 'string') return node;
    return node.children.map((child) => renderedText(child)).join(' ');
}

/** The header's title, and the text of its facts line as rendered. */
function identityHeader(screen: Awaited<ReturnType<typeof renderScreen>>) {
    const header = screen.findAll((node) => node.props.testID === 'settings-account-identity'
        && typeof node.props.title === 'string')[0];
    expect(header).toBeTruthy();
    const meta = screen.findAll((node) => node.props.testID === 'settings-account-identity-meta')[0];
    return {
        title: header!.props.title as string,
        facts: renderedText(meta as unknown as RenderedNode | undefined),
        text: renderedText(header as unknown as RenderedNode),
    };
}

describe('Settings → Account identity header', () => {
    afterEach(() => {
        boundary.executedActionIds = [];
        boundary.holdSecurityRead = false;
        resetSessionSettingsEntryState();
        standardCleanup();
    });

    it('names the person through the canonical display name when there is no first name', async () => {
        boundary.profile = { ...profileDefaults, id: 'prof_1', firstName: null, lastName: null, username: 'lee' };
        boundary.encryptionMode = 'plain';

        const screen = await renderAccount();
        const header = identityHeader(screen);

        expect(header.title).toBe('lee');
        expect(header.facts).toContain('@lee');
    });

    it('states end-to-end encryption from the Account encryption mode, not from a held key', async () => {
        boundary.profile = { ...profileDefaults, id: 'prof_1', firstName: 'Lee', username: 'lee' };
        boundary.encryptionMode = 'plain';
        const plain = await renderAccount();
        await vi.waitFor(() => expect(plain.findByTestId('settings-account-email-password')?.props.subtitle)
            .toContain('lee@example.test'));
        expect(identityHeader(plain).facts).not.toContain('settingsAccount.endToEndEncrypted');
        expect(plain.findByTestId('settings-account-signin-recovery-key')).toBeNull();
        standardCleanup();

        boundary.executedActionIds = [];
        boundary.encryptionMode = 'e2ee';
        const encrypted = await renderAccount();
        await vi.waitFor(() => expect(identityHeader(encrypted).facts).toContain('settingsAccount.endToEndEncrypted'));
        expect(encrypted.findByTestId('settings-account-signin-recovery-key')).not.toBeNull();
    });

    it('shows the Account ID this device is signed in with and copies it', async () => {
        boundary.profile = { ...profileDefaults, id: 'prof_1', firstName: 'Lee' };
        boundary.encryptionMode = 'plain';
        boundary.clipboard = [];
        const screen = await renderAccount();

        const accountId = screen.findByTestId('settings-account-id');
        expect(accountId).not.toBeNull();
        expect(screen.getTextContent()).toContain('acct_7f3c9e21');
        await screen.pressByTestIdAsync('settings-account-id-copy');
        expect(boundary.clipboard).toEqual(['acct_7f3c9e21']);
    });

    it('reserves the encryption fact and the recovery-key row while the Account facts are loading', async () => {
        boundary.profile = { ...profileDefaults, id: 'prof_1', firstName: 'Lee', username: null };
        boundary.holdSecurityRead = true;
        const screen = await renderAccount();

        expect(screen.findByTestId('settings-account-recovery-key-loading')).not.toBeNull();
        expect(identityHeader(screen).facts).not.toContain('ndToEndEncrypted');
    });

    it('states the encryption mode for a plaintext Account too, so the fact never appears or vanishes', async () => {
        boundary.profile = { ...profileDefaults, id: 'prof_1', firstName: 'Lee', username: null };
        boundary.encryptionMode = 'plain';
        const screen = await renderAccount();

        await vi.waitFor(() => expect(identityHeader(screen).facts).toContain('settingsAccount.notEndToEndEncrypted'));
        expect(screen.findByTestId('settings-account-recovery-key-loading')).toBeNull();
    });

    it('puts the encryption fact, with its lock, directly under the Account ID', async () => {
        boundary.profile = { ...profileDefaults, id: 'prof_1', firstName: 'Lee', username: null };
        boundary.encryptionMode = 'e2ee';
        const screen = await renderAccount();

        await vi.waitFor(() => expect(identityHeader(screen).facts).toContain('settingsAccount.endToEndEncrypted'));
        const { text } = identityHeader(screen);
        expect(text.indexOf('acct_7f3c9e21')).toBeGreaterThan(-1);
        expect(text.indexOf('acct_7f3c9e21')).toBeLessThan(text.indexOf('settingsAccount.endToEndEncrypted'));
        const fact = screen.findByTestId('settings-account-encryption-fact');
        expect(fact?.findAll((node) => node.props.name === 'lock').length).toBeGreaterThan(0);
    });
});
