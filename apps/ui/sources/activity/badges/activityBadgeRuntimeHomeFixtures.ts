import { accountSettingsParse } from '@happier-dev/protocol';

/**
 * Deterministic Home identity for badge runtime tests: one Home per `serverId`, each with its own
 * Account. The badge resolves policy per Home, so a fixture that collapsed two Homes onto one
 * Account could not express the defect these tests cover.
 */
export function resolveBadgeHomeServerUrl(serverId: string): string {
    return `https://${serverId}.example.test`;
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
        accountSettingsParse(raw),
        version,
    );
}
