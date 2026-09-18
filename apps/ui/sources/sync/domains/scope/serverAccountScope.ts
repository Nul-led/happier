export type ServerAccountScope = Readonly<{
    serverId: string;
    accountId: string;
}>;

/** Currentness and synchronous retirement for one exact Home/Account scope. */
export type ServerAccountScopeLifetime = Readonly<{
    scope: ServerAccountScope;
    isCurrent(): boolean;
    onRetire(cancel: () => void): Readonly<{ dispose(): void }>;
}>;

function normalizeServerAccountScopePart(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export function createServerAccountScope(serverId: unknown, accountId: unknown): ServerAccountScope | null {
    const normalizedServerId = normalizeServerAccountScopePart(serverId);
    const normalizedAccountId = normalizeServerAccountScopePart(accountId);
    if (!normalizedServerId || !normalizedAccountId) return null;
    return {
        serverId: normalizedServerId,
        accountId: normalizedAccountId,
    };
}

export function areServerAccountScopesEqual(
    a: ServerAccountScope | null | undefined,
    b: ServerAccountScope | null | undefined,
): boolean {
    if (!a || !b) return false;
    return a.serverId === b.serverId && a.accountId === b.accountId;
}

function encodeScopePart(value: string): string {
    return `${value.length}:${value}`;
}

export function serverAccountScopeKeySuffix(scope: ServerAccountScope): string {
    return `${encodeScopePart(scope.serverId)}${encodeScopePart(scope.accountId)}`;
}

/** Collision-safe identity for an ordered set of exact Home/Account scopes. */
export function serverAccountScopeListKey(scopes: readonly ServerAccountScope[]): string {
    return scopes.map((scope) => encodeScopePart(serverAccountScopeKeySuffix(scope))).join('');
}

export function serverAccountScopedStorageKey(prefix: string, scope: ServerAccountScope): string {
    return `${prefix}:${serverAccountScopeKeySuffix(scope)}`;
}

/** Collision-safe identity for child projections within one Account scope. */
export function serverAccountScopedResourceKey(
    scope: ServerAccountScope,
    ...parts: readonly string[]
): string {
    return `${serverAccountScopeKeySuffix(scope)}${parts.map(encodeScopePart).join('')}`;
}
