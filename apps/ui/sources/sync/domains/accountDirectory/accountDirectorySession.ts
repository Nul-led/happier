import {
    AccountDirectoryCapabilitiesSchema,
    type AccountDirectoryCapabilities,
} from '@happier-dev/protocol';
import {
    createAccountDirectoryClient,
    type AccountDirectoryClient,
    type AccountDirectoryHomeEntryV1,
    type AccountDirectoryMeResponseV1,
    type HomeConnectionDescriptorV1,
} from '@/sync/api/accountDirectory/accountDirectoryClient';
import type { AccountDirectoryCredentialTarget } from '@/auth/storage/tokenStorage';
import {
    accountDirectoryCredentialStorage,
    normalizeAccountDirectoryEndpoint,
} from '@/auth/accountDirectory/accountDirectoryCredentialStorage';

export type AccountDirectorySessionStatus = 'idle' | 'loading' | 'ready' | 'stale' | 'unsupported' | 'error';
export type AccountDirectorySessionSnapshot = Readonly<{
    endpoint: string;
    status: AccountDirectorySessionStatus;
    account: AccountDirectoryMeResponseV1 | null;
    homes: readonly AccountDirectoryHomeEntryV1[];
    preferredHomeServerIdentityId: string | null;
    refreshedAtMs: number | null;
    error: unknown | null;
}>;

type SessionOptions = Readonly<{
    client?: AccountDirectoryClient;
    capability: AccountDirectoryCapabilities;
}>;

export function parseAccountDirectoryCapability(value: unknown): AccountDirectoryCapabilities | null {
    const parsed = AccountDirectoryCapabilitiesSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

function initialSnapshot(endpoint: string): AccountDirectorySessionSnapshot {
    return {
        endpoint,
        status: 'idle',
        account: null,
        homes: [],
        preferredHomeServerIdentityId: null,
        refreshedAtMs: null,
        error: null,
    };
}

export class AccountDirectorySession {
    private readonly listeners = new Set<(snapshot: AccountDirectorySessionSnapshot) => void>();
    private readonly client: AccountDirectoryClient;
    private readonly capability: AccountDirectoryCapabilities | null;
    private snapshotValue: AccountDirectorySessionSnapshot;
    private refreshPromise: Promise<AccountDirectorySessionSnapshot> | null = null;
    private readonly credentialTarget: AccountDirectoryCredentialTarget;

    constructor(target: AccountDirectoryCredentialTarget, options: SessionOptions) {
        const normalized = normalizeAccountDirectoryEndpoint(target.endpoint);
        if (!normalized) throw new Error('Invalid Account Service endpoint');
        const identityRaw = target.serverIdentityId ?? null;
        const serverIdentityId = typeof identityRaw === 'string' && identityRaw.trim()
            ? identityRaw.trim()
            : null;
        this.credentialTarget = { endpoint: normalized, ...(serverIdentityId ? { serverIdentityId } : {}) };
        this.snapshotValue = initialSnapshot(normalized);
        this.client = options.client ?? createAccountDirectoryClient(this.credentialTarget);
        this.capability = parseAccountDirectoryCapability(options.capability);
    }

    get snapshot(): AccountDirectorySessionSnapshot {
        return this.snapshotValue;
    }

    subscribe(listener: (snapshot: AccountDirectorySessionSnapshot) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    async requestLoginAssertion(homeServerIdentityId: string, clientBoxPublicKeyBase64: string) {
        if (this.capability?.homeEnrollment !== true) {
            this.update({ ...this.snapshotValue, status: 'unsupported', error: null });
            throw new Error('Account Service Home enrollment is unsupported');
        }
        return await this.client.requestLoginAssertion(homeServerIdentityId, { clientBoxPublicKeyBase64 });
    }

    /** Minimal authenticated account projection; the subject used for Home relationship provisioning. */
    async readAccountSummary(): Promise<AccountDirectoryMeResponseV1> {
        return await this.client.getMe();
    }

    /** Idempotent directory publication of one Home entry; requires the advertised Home directory capability. */
    async putHome(home: Readonly<{
        homeServerIdentityId: string;
        label: string;
        connectionDescriptor: HomeConnectionDescriptorV1;
    }>): Promise<AccountDirectoryHomeEntryV1> {
        if (this.capability?.homeDirectory !== true) {
            this.update({ ...this.snapshotValue, status: 'unsupported', error: null });
            throw new Error('Account Service Home directory is unsupported');
        }
        return await this.client.putHome(home);
    }

    /** Updates only the Account Service recommendation; callers refresh the projection afterwards. */
    async setPreferredHome(homeServerIdentityId: string) {
        if (this.capability?.homeDirectory !== true) {
            this.update({ ...this.snapshotValue, status: 'unsupported', error: null });
            throw new Error('Account Service Home directory is unsupported');
        }
        return await this.client.setPreferredHome(homeServerIdentityId);
    }

    /** Removes only Directory metadata; local Home profiles and credentials are outside this owner. */
    async deleteHome(homeServerIdentityId: string) {
        if (this.capability?.homeDirectory !== true) {
            this.update({ ...this.snapshotValue, status: 'unsupported', error: null });
            throw new Error('Account Service Home directory is unsupported');
        }
        return await this.client.deleteHome(homeServerIdentityId);
    }

    private update(next: AccountDirectorySessionSnapshot): void {
        this.snapshotValue = next;
        for (const listener of this.listeners) listener(next);
    }

    async refresh(): Promise<AccountDirectorySessionSnapshot> {
        if (this.refreshPromise) return await this.refreshPromise;
        if (this.capability?.homeDirectory !== true) {
            this.update({ ...this.snapshotValue, status: 'unsupported', error: null });
            return this.snapshotValue;
        }

        this.update({ ...this.snapshotValue, status: 'loading', error: null });
        this.refreshPromise = (async () => {
            try {
                const [account, homes] = await Promise.all([
                    this.client.getMe(),
                    this.client.listHomes(),
                ]);
                const next: AccountDirectorySessionSnapshot = {
                    ...this.snapshotValue,
                    status: 'ready',
                    account,
                    homes: homes.homes,
                    preferredHomeServerIdentityId: homes.preferredHomeServerIdentityId ?? null,
                    refreshedAtMs: Date.now(),
                    error: null,
                };
                this.update(next);
                return next;
            } catch (error) {
                const next: AccountDirectorySessionSnapshot = {
                    ...this.snapshotValue,
                    status: this.snapshotValue.homes.length > 0 ? 'stale' : 'error',
                    error,
                };
                this.update(next);
                return next;
            } finally {
                this.refreshPromise = null;
            }
        })();
        return await this.refreshPromise;
    }

    async logout(): Promise<boolean> {
        const removed = await accountDirectoryCredentialStorage.logout(this.credentialTarget);
        this.update({ ...this.snapshotValue, account: null, status: 'idle', error: null });
        return removed;
    }
}

export function createAccountDirectorySession(target: AccountDirectoryCredentialTarget, options: SessionOptions): AccountDirectorySession {
    return new AccountDirectorySession(target, options);
}
