import {
    areServerAccountScopesEqual,
    createServerAccountScope,
    serverAccountScopeKeySuffix,
    type ServerAccountScope,
    type ServerAccountScopeLifetime,
} from '../../scope/serverAccountScope';

export type AccountSettingsScope = ServerAccountScope;

/**
 * The Home/Account lifetime captured by a mounted Account Settings operation.
 * Consumers use `isCurrent` before publishing or mutating; the scope itself
 * keeps the account identity visible at every migration boundary.
 */
export type AccountEncryptionMigrationScope = Pick<ServerAccountScopeLifetime, 'scope' | 'isCurrent'>;

export function assertAccountEncryptionMigrationScopeCurrent(
    scope: AccountEncryptionMigrationScope,
): void {
    if (!scope.isCurrent()) {
        throw new Error('Account Settings request scope changed');
    }
}

export const createAccountSettingsScope = createServerAccountScope;

export function areAccountSettingsScopesEqual(
    a: AccountSettingsScope | null | undefined,
    b: AccountSettingsScope | null | undefined,
): boolean {
    return areServerAccountScopesEqual(a, b);
}

export function accountSettingsScopeKeySuffix(scope: AccountSettingsScope): string {
    return serverAccountScopeKeySuffix(scope);
}
