import {
    createNativeSshTunnelAdapter,
    type NativeSshTunnelAuthPromptResolver,
    type NativeSshTunnelHostKeyPromptResolver,
    type NativeSshTunnelCredentialResolution,
} from './adapter';
import { createNativeSshTunnelSupervisor } from './supervisor';
import type {
    NativeSshCredentialsRef,
    NativeSshTunnelLease,
    NativeSshTunnelRequest,
    NativeSshTunnelSnapshot,
    NativeSshTunnelSupervisor,
} from './types';

export type NativeSshTunnelRuntime = NativeSshTunnelSupervisor & Readonly<{
    subscribe: (listener: () => void) => () => void;
}>;

type RuntimeFactoryParams = Readonly<{
    createSupervisor?: () => NativeSshTunnelSupervisor;
}>;

const credentialResolutionsByRefKey = new Map<string, NativeSshTunnelCredentialResolution>();
let singletonRuntime: NativeSshTunnelRuntime | null = null;
let hostKeyPromptResolver: NativeSshTunnelHostKeyPromptResolver | null = null;
let authPromptResolver: NativeSshTunnelAuthPromptResolver | null = null;

function buildCredentialRefKey(credentialsRef: NativeSshCredentialsRef): string {
    return JSON.stringify({
        remoteHostId: credentialsRef.remoteHostId,
        credentialId: credentialsRef.credentialId,
        storage: credentialsRef.storage,
    });
}

function createDefaultSupervisor(): NativeSshTunnelSupervisor {
    return createNativeSshTunnelSupervisor({
        adapter: createNativeSshTunnelAdapter({
            promptHostKey: async (event, request) => {
                if (!hostKeyPromptResolver) {
                    return {
                        decision: 'reject',
                        reason: 'Native SSH tunnel host-key prompt was not handled.',
                    };
                }
                return await hostKeyPromptResolver(event, request);
            },
            promptAuth: async (event, request) => {
                if (!authPromptResolver) {
                    return {
                        decision: 'cancel',
                        reason: 'Native SSH tunnel authentication prompt was not handled.',
                    };
                }
                return await authPromptResolver(event, request);
            },
            resolveCredentials: async (credentialsRef) => {
                const credentials = readNativeSshTunnelCredentialResolution(credentialsRef);
                if (!credentials) {
                    throw new Error('native_ssh_tunnel_missing_credentials');
                }
                return credentials;
            },
        }),
    });
}

export function setNativeSshTunnelCredentialResolution(
    credentialsRef: NativeSshCredentialsRef,
    credentials: NativeSshTunnelCredentialResolution,
): void {
    credentialResolutionsByRefKey.set(buildCredentialRefKey(credentialsRef), credentials);
}

export function readNativeSshTunnelCredentialResolution(
    credentialsRef: NativeSshCredentialsRef,
): NativeSshTunnelCredentialResolution | null {
    return credentialResolutionsByRefKey.get(buildCredentialRefKey(credentialsRef)) ?? null;
}

export function setNativeSshTunnelHostKeyPromptResolver(
    resolver: NativeSshTunnelHostKeyPromptResolver | null,
): void {
    hostKeyPromptResolver = resolver;
}

export function setNativeSshTunnelAuthPromptResolver(
    resolver: NativeSshTunnelAuthPromptResolver | null,
): void {
    authPromptResolver = resolver;
}

function clearNativeSshTunnelCredentialResolution(credentialsRef: NativeSshCredentialsRef): void {
    credentialResolutionsByRefKey.delete(buildCredentialRefKey(credentialsRef));
}

export function createNativeSshTunnelRuntime(params: Readonly<{
    supervisor: NativeSshTunnelSupervisor;
}>): NativeSshTunnelRuntime {
    const listeners = new Set<() => void>();
    const credentialRefsByLeaseId = new Map<string, Map<string, NativeSshCredentialsRef>>();
    let suspended = false;

    function notify(): void {
        for (const listener of [...listeners]) {
            listener();
        }
    }

    return {
        async ensureTunnel(request: NativeSshTunnelRequest): Promise<NativeSshTunnelLease> {
            if (suspended) {
                throw new Error('native_ssh_tunnel_suspended');
            }
            try {
                const lease = await params.supervisor.ensureTunnel(request);
                const refs = credentialRefsByLeaseId.get(lease.leaseId) ?? new Map<string, NativeSshCredentialsRef>();
                refs.set(buildCredentialRefKey(request.credentialsRef), request.credentialsRef);
                credentialRefsByLeaseId.set(lease.leaseId, refs);
                return lease;
            } catch (error) {
                clearNativeSshTunnelCredentialResolution(request.credentialsRef);
                throw error;
            } finally {
                notify();
            }
        },
        listTunnels(): NativeSshTunnelSnapshot {
            return params.supervisor.listTunnels();
        },
        async releaseTunnel(leaseId: string): Promise<void> {
            const credentialsRefs = credentialRefsByLeaseId.get(leaseId);
            try {
                await params.supervisor.releaseTunnel(leaseId);
                const leaseStillRetained = params.supervisor.listTunnels().leases
                    .some((lease) => lease.leaseId === leaseId);
                if (credentialsRefs && !leaseStillRetained) {
                    for (const credentialsRef of credentialsRefs.values()) {
                        clearNativeSshTunnelCredentialResolution(credentialsRef);
                    }
                    credentialRefsByLeaseId.delete(leaseId);
                }
            } catch (error) {
                if (credentialsRefs) {
                    for (const credentialsRef of credentialsRefs.values()) {
                        clearNativeSshTunnelCredentialResolution(credentialsRef);
                    }
                    credentialRefsByLeaseId.delete(leaseId);
                }
                throw error;
            } finally {
                notify();
            }
        },
        markSuspended(): void {
            suspended = true;
            params.supervisor.markSuspended();
            notify();
        },
        async markForeground(): Promise<void> {
            try {
                suspended = false;
                await params.supervisor.markForeground();
            } finally {
                notify();
            }
        },
        subscribe(listener: () => void): () => void {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export function getNativeSshTunnelRuntime(params: RuntimeFactoryParams = {}): NativeSshTunnelRuntime {
    if (!singletonRuntime) {
        singletonRuntime = createNativeSshTunnelRuntime({
            supervisor: (params.createSupervisor ?? createDefaultSupervisor)(),
        });
    }
    return singletonRuntime;
}

export async function disposeNativeSshTunnelRuntime(): Promise<void> {
    singletonRuntime = null;
    hostKeyPromptResolver = null;
    authPromptResolver = null;
    credentialResolutionsByRefKey.clear();
}
