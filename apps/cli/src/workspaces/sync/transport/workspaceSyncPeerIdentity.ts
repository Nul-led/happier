import type { Socket } from 'node:net';

import {
    PROCESS_CUSTODY_PEER_IDENTITY_PLATFORMS,
    observeLocalIpcPeerIdentity,
    resolveProcessCustodyPeerIdentityExecutable,
    type ProcessCustodyPeerIdentity,
} from '@/subprocess/supervision/processCustody';
import type { WorkspaceSyncBrokerPeerIdentityContext } from './workspaceSyncBroker';

export type { WorkspaceSyncBrokerPeerIdentityContext };

/**
 * The OS peer-identity validator consumed as
 * `WorkspaceSyncBrokerConfig.validatePeerIdentity`. The broker hands every
 * admitted control and data connection to `validate`, which proves through the
 * native custody helper that the connection's peer is the exact expected
 * sidecar process — never "any same-user process".
 */
export interface WorkspaceSyncPeerIdentityValidator {
    /**
     * Bind the actual spawned sidecar pid, supplied by the sidecar lifecycle
     * once the managed child exists (after spawn, before readiness is
     * awaited). Until this is called, every validation fails closed.
     */
    setExpectedSidecarPid(pid: number): void;
    validate(context: WorkspaceSyncBrokerPeerIdentityContext): Promise<boolean>;
}

export type WorkspaceSyncPeerIdentityDependencies = Readonly<{
    platform?: NodeJS.Platform;
    resolveExecutable?: (platform: NodeJS.Platform) => string | null;
    observe?: typeof observeLocalIpcPeerIdentity;
    getUid?: () => number | undefined;
}>;

/**
 * Create the broker-facing validator. One validator instance serves the one
 * broker listener per daemon installation; both the control and the data
 * connection of the managed sidecar are proved against the same expected pid.
 * Every unprovable question — missing helper, missing expectation, helper
 * failure, platform without an exact primitive, pid/uid mismatch — is `false`.
 * The validator never observes or stores the launch secret: the helper command
 * takes none, and nothing here reads one.
 */
export function createWorkspaceSyncPeerIdentityValidator(
    dependencies: WorkspaceSyncPeerIdentityDependencies = {},
): WorkspaceSyncPeerIdentityValidator {
    const platform = dependencies.platform ?? process.platform;
    const resolveExecutable = dependencies.resolveExecutable ?? resolveProcessCustodyPeerIdentityExecutable;
    const observe = dependencies.observe ?? observeLocalIpcPeerIdentity;
    const getUid = dependencies.getUid ?? (() => (typeof process.getuid === 'function' ? process.getuid() : undefined));
    const supportsExactPeerPrimitive = PROCESS_CUSTODY_PEER_IDENTITY_PLATFORMS.some((supported) => supported === platform);
    let expectedSidecarPid: number | null = null;

    return {
        setExpectedSidecarPid(pid: number): void {
            if (!Number.isSafeInteger(pid) || pid < 1) {
                throw new TypeError('the expected workspace sync sidecar pid must be a positive integer');
            }
            expectedSidecarPid = pid;
        },

        async validate(context: WorkspaceSyncBrokerPeerIdentityContext): Promise<boolean> {
            const expected = expectedSidecarPid;
            if (expected === null) return false;
            if (context.sidecarPid !== undefined && context.sidecarPid !== expected) return false;
            if (!supportsExactPeerPrimitive) return false;
            if (platform === 'win32') {
                // The secured native pipe relay observes the real client PID
                // before bridging to this loopback Socket and authenticates
                // that witness with its inherited one-launch secret. The
                // TypeScript broker never accepts an unwitnessed TCP peer.
                return context.witnessedPeerPid === expected;
            }
            const executablePath = resolveExecutable(platform);
            if (!executablePath) return false;
            let identity: ProcessCustodyPeerIdentity | null;
            try {
                identity = await observe({ socket: context.socket, executablePath });
            } catch {
                return false;
            }
            if (identity === null || identity.pid !== expected) return false;
            const uid = getUid();
            return uid !== undefined && identity.uid === uid;
        },
    };
}
