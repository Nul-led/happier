import { AppState } from 'react-native';

import {
    createNativeSshTunnelAdapter,
    type NativeSshTunnelAuthPromptResolver,
    type NativeSshTunnelHostKeyPromptResolver,
    type NativeSshTunnelCredentialResolution,
} from './adapter';
import { createNativeSshTunnelSupervisor } from './supervisor';
import { disposeIrohHomeTunnelRuntime, getIrohHomeTunnelRuntime } from '@/sync/runtime/nativeIrohTunnels/runtime';
import type { IrohHomeTunnelRuntime } from '@/sync/runtime/nativeIrohTunnels/types';
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

type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

type AppStateLike = Readonly<{
    currentState?: AppStateStatus | string;
    addEventListener: (
        event: 'change',
        listener: (state: AppStateStatus | string) => void | Promise<void>,
    ) => Readonly<{ remove: () => void }>;
}>;

type RuntimeFactoryParams = Readonly<{
    createSupervisor?: () => NativeSshTunnelSupervisor;
}>;

const credentialResolutionsByRefKey = new Map<string, NativeSshTunnelCredentialResolution>();
let singletonRuntime: NativeSshTunnelRuntime | null = null;
let singletonLifecycleSubscription: Readonly<{ remove: () => void }> | null = null;
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

export function bindNativeSshTunnelRuntimeAppState(params: Readonly<{
    appState: AppStateLike;
    runtime: NativeSshTunnelRuntime;
    /** Companion tunnel runtimes (e.g. Iroh) driven by the same app-state lifecycle mount. */
    additionalRuntimes?: readonly Pick<IrohHomeTunnelRuntime, 'markSuspended' | 'markForeground'>[];
}>): Readonly<{ remove: () => void }> {
    const runtimes = [params.runtime, ...(params.additionalRuntimes ?? [])];
    const onStateChange = async (state: AppStateStatus | string): Promise<void> => {
        if (state === 'background' || state === 'inactive') {
            for (const runtime of runtimes) runtime.markSuspended();
            return;
        }
        if (state === 'active') {
            for (const runtime of runtimes) await runtime.markForeground();
        }
    };

    const subscription = params.appState.addEventListener('change', onStateChange);
    if (params.appState.currentState === 'background' || params.appState.currentState === 'inactive') {
        for (const runtime of runtimes) runtime.markSuspended();
    }
    return subscription;
}

export function startNativeSshTunnelRuntimeAppStateLifecycle(): void {
    if (singletonLifecycleSubscription) {
        return;
    }
    // One app-state mount owns suspend/foreground recovery for every native
    // tunnel lifecycle (SSH and Iroh); there is no second AppState singleton.
    singletonLifecycleSubscription = bindNativeSshTunnelRuntimeAppState({
        appState: AppState,
        runtime: getNativeSshTunnelRuntime(),
        additionalRuntimes: [getIrohHomeTunnelRuntime()],
    });
}

export async function disposeNativeSshTunnelRuntime(): Promise<void> {
    singletonLifecycleSubscription?.remove();
    singletonLifecycleSubscription = null;
    singletonRuntime = null;
    hostKeyPromptResolver = null;
    authPromptResolver = null;
    credentialResolutionsByRefKey.clear();
    await disposeIrohHomeTunnelRuntime();
}
