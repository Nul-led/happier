import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { areServerAccountScopesEqual, serverAccountScopedResourceKey } from '@/sync/domains/scope/serverAccountScope';
import type { ServerAccountScopeLifetime } from '@/sync/domains/scope/serverAccountScope';
import type { SessionAddress } from '@/sync/domains/session/sessionAddress';

import {
    createSessionDiscussionRepository,
    type SessionDiscussionRepository,
    type SessionDiscussionRepositoryClient,
} from './sessionDiscussionRepository';

type RegisteredRepository = {
    repository: SessionDiscussionRepository;
    retirement?: Readonly<{ dispose(): void }>;
};

const repositories = new Map<string, RegisteredRepository>();
const registrationListeners = new Map<string, Set<() => void>>();

function repositoryKey(scope: ServerAccountScope, address: SessionAddress): string {
    if (scope.serverId !== address.serverId) {
        throw new Error('Session Discussion repository requires the exact Session Home');
    }
    return serverAccountScopedResourceKey(scope, 'session-discussions', address.sessionId);
}

/**
 * Canonical in-memory owner for one Account + Home + Session Discussion projection.
 * List and detail surfaces share this instance so navigation cannot fork pagination,
 * optimistic identities, approval state, or outcome-unknown reconciliation.
 */
export function getSessionDiscussionRepository(options: Readonly<{
    scope: ServerAccountScope;
    address: SessionAddress;
    client: SessionDiscussionRepositoryClient;
    accountLifetime?: ServerAccountScopeLifetime | null;
}>): SessionDiscussionRepository {
    if (options.accountLifetime && !areServerAccountScopesEqual(options.accountLifetime.scope, options.scope)) {
        throw new Error('Session Discussion repository Account lifetime must match its exact Account scope');
    }
    const key = repositoryKey(options.scope, options.address);
    const existing = repositories.get(key);
    if (existing) {
        existing.repository.setClient(options.client);
        if (!existing.retirement && options.accountLifetime) {
            existing.retirement = options.accountLifetime.onRetire(() => retireRegisteredRepository(key));
        }
        return existing.repository;
    }
    const repository = createSessionDiscussionRepository({ address: options.address, client: options.client });
    const registered: RegisteredRepository = { repository };
    repositories.set(key, registered);
    for (const listener of [...registrationListeners.get(key) ?? []]) listener();
    if (options.accountLifetime) {
        registered.retirement = options.accountLifetime.onRetire(() => retireRegisteredRepository(key));
    }
    return repository;
}

function retireRegisteredRepository(key: string): void {
    const existing = repositories.get(key);
    if (!existing) return;
    repositories.delete(key);
    for (const listener of [...registrationListeners.get(key) ?? []]) listener();
    existing.retirement?.dispose();
    existing.repository.clear();
}

/** Chrome reads the same repository as list/detail bodies without creating a client or mounting a watcher. */
export function readRegisteredSessionDiscussionRepository(scope: ServerAccountScope, address: SessionAddress): SessionDiscussionRepository | null {
    return repositories.get(repositoryKey(scope, address))?.repository ?? null;
}

/** Follow both an existing projection and a body that registers it after its chrome mounted. */
export function subscribeRegisteredSessionDiscussionRepository(scope: ServerAccountScope, address: SessionAddress, listener: () => void): () => void {
    const key = repositoryKey(scope, address);
    let unsubscribe: (() => void) | undefined;
    const bind = () => {
        unsubscribe?.();
        unsubscribe = repositories.get(key)?.repository.subscribe(listener);
        listener();
    };
    const listeners = registrationListeners.get(key) ?? new Set<() => void>();
    listeners.add(bind);
    registrationListeners.set(key, listeners);
    unsubscribe = repositories.get(key)?.repository.subscribe(listener);
    return () => {
        unsubscribe?.();
        listeners.delete(bind);
        if (!listeners.size) registrationListeners.delete(key);
    };
}

/** Explicit scope retirement hook for Account removal/sign-out. */
export function retireSessionDiscussionRepository(options: Readonly<{
    scope: ServerAccountScope;
    address: SessionAddress;
}>): void {
    const key = repositoryKey(options.scope, options.address);
    retireRegisteredRepository(key);
}

export function clearSessionDiscussionRepositoryRegistryForTests(): void {
    for (const key of [...repositories.keys()]) retireRegisteredRepository(key);
}
