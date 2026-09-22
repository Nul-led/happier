import { settingsParse } from '@/sync/domains/settings/settings';

/**
 * Deterministic Home identity for badge runtime tests: one Home per `serverId`, each with its own
 * Account. The badge resolves policy per Home, so a fixture that collapsed two Homes onto one
 * Account could not express the defect these tests cover.
 *
 * The host is the Home id on purpose. These suites address Homes by `serverId` everywhere, and the
 * real profile owner derives a saved Home's id from its URL host
 * (`serverProfiles.ts#deriveServerIdFromUrl`), so this is the address at which saving `server-1`
 * through `upsertServerProfile` yields the id `server-1` — which is what lets the suites drive the
 * real Home owner instead of module-mocking it.
 */
export function resolveBadgeHomeServerUrl(serverId: string): string {
    return `https://${serverId}`;
}

export function resolveBadgeHomeAccountId(serverId: string): string {
    return serverId.replace(/^server-/, 'account-');
}

/** Writes one Home's exact Account settings through the real persistence owner. */
export async function persistBadgeHomeAccountSettings(
    serverId: string,
    raw: Readonly<Record<string, unknown>> = {},
    version = 1,
): Promise<void> {
    const { saveAccountSettings } = await import('@/sync/domains/state/accountSettingsPersistence');
    saveAccountSettings(
        { serverId, accountId: resolveBadgeHomeAccountId(serverId) },
        settingsParse(raw),
        version,
    );
}
