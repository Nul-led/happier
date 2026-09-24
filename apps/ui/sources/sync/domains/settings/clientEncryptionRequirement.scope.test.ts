import { describe, expect, it, vi } from 'vitest';

import { settingsDefaults, type Settings } from '@/sync/domains/settings/settings';
import { saveAccountSettings } from '@/sync/domains/state/accountSettingsPersistence';

import { resolveUiClientEncryptionRequirementForScope } from './clientEncryptionRequirement';

// Native key-value storage boundary; the scoped Account settings persistence owner above it is real.
const nativeStore = vi.hoisted(() => new Map<string, string>());
vi.mock('react-native-mmkv', () => {
    class MMKV {
        getString(key: string) { return nativeStore.get(key); }
        set(key: string, value: string) { nativeStore.set(key, value); }
        delete(key: string) { nativeStore.delete(key); }
        clearAll() { nativeStore.clear(); }
    }
    return { MMKV };
});

const focusedScope = { serverId: 'home-a', accountId: 'account-a' } as const;
const secondaryScope = { serverId: 'home-b', accountId: 'account-b' } as const;

function persist(scope: typeof focusedScope | typeof secondaryScope, overrides: Partial<Settings>): Settings {
    const settings = { ...settingsDefaults, ...overrides } as Settings;
    saveAccountSettings(scope, settings, 1);
    return settings;
}

/**
 * The owner every concurrent/scoped Session reader calls (concurrent ordinary refresh,
 * concurrent query page, scoped by-id hydration, scoped metadata inventory): a Home's
 * Sessions are admitted under that Home Account's own requirement.
 */
describe('resolveUiClientEncryptionRequirementForScope', () => {
    it('reads a secondary Home under its own Account settings, never the focused Account projection', () => {
        const focusedStrict = persist(focusedScope, { clientEncryptionRequirementV1: 'require_e2ee' });
        persist(secondaryScope, { clientEncryptionRequirementV1: 'follow_account' });

        // A's strict preference must not hide B's permitted plaintext Sessions.
        expect(resolveUiClientEncryptionRequirementForScope({
            scope: secondaryScope,
            focusedSettings: focusedStrict,
        })).toBe('follow_account');

        // Reversed: A's permissive preference must not admit B's plaintext rows
        // against B's own local minimum.
        const focusedPermissive = persist(focusedScope, { clientEncryptionRequirementV1: 'follow_account' });
        persist(secondaryScope, { clientEncryptionRequirementLocalV1: 'require_e2ee' });
        expect(resolveUiClientEncryptionRequirementForScope({
            scope: secondaryScope,
            focusedSettings: focusedPermissive,
        })).toBe('require_e2ee');
    });
});
