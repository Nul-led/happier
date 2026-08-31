import { stat } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { IrohError } from '@happier-dev/iroh-native';
import { parseIrohEndpointDescriptorV1, type IrohEndpointDescriptorV1 } from '@happier-dev/protocol';
import { resolvePersonalHomeRuntimeLayout } from '@happier-dev/cli-common/firstPartyRuntime';
import { resolveBoundServerListener } from '@/app/runtime/startupReceipt';
import { getOrCreateServerIdentityId } from '@/app/serverIdentity/serverIdentity';
import { resolveConfiguredCanonicalServerUrl } from '@/app/serverUrls/effectiveServerUrls';
import { log } from '@/utils/logging/log';
import { readHomeIrohEndpointConfigFromEnv, type HomeIrohEndpointEnvConfig } from './homeIrohEndpointConfig';
import {
    readHomeIrohEndpointContinuity,
    resolveHomeIrohEndpointContinuityPath,
    writeHomeIrohEndpointContinuity,
} from './homeIrohEndpointContinuity';
import {
    loadHomeIrohNativeLifecycle,
    type HomeIrohNativeLifecycle,
} from './homeIrohNativeLifecycle';

/**
 * Canonical server-side owner of the managed Personal Home Iroh endpoint
 * (server-light Home acceptor). startServer composes it once, after the API
 * has listened, for flavor `light` with role `all`/`api`:
 *
 *   existing startApi listener -> one persistent Iroh endpoint (keyed by the
 *   canonical runtime layout key) -> one Home acceptor fixed to
 *   127.0.0.1:<actual Fastify port> -> published descriptor snapshot.
 *
 * Fail-closed contract: invalid explicit Iroh config, missing canonical auth
 * audience, continuity/key loss, endpoint identity drift, native config
 * conflicts, or a descriptor that does not parse through the protocol-owned
 * parser fail the Iroh composition closed and never publish a descriptor.
 * Native addon unavailability is a target-specific carrier failure: the Home
 * process stays runnable with an honest unavailable status. Relay policy and
 * URL configuration select Iroh behavior when the carrier exists; they do
 * not make the otherwise optional carrier a server-startup requirement.
 *
 * All tunnel payload bytes move in the native core; this owner manages
 * lifecycle only and exposes a small carrier-neutral seam
 * (`getHomeIrohEndpointState`) for descriptor consumers.
 */

const HOME_IROH_ACCEPTOR_TARGET_HOST = '127.0.0.1';

export type HomeIrohEndpointLifecycleStatus = 'not-composed' | 'active' | 'unavailable' | 'failed';

export type HomeIrohEndpointFailureReason =
    | 'invalid_iroh_config'
    | 'canonical_server_url_missing'
    | 'server_identity_unavailable'
    | 'api_listen_port_unavailable'
    | 'continuity_metadata_unreadable'
    | 'endpoint_key_lost'
    | 'endpoint_key_unavailable'
    | 'endpoint_config_conflict'
    | 'home_identity_drift'
    | 'endpoint_identity_drift'
    | 'endpoint_not_active'
    | 'acceptor_not_running'
    | 'descriptor_invalid'
    | 'continuity_write_failed'
    | 'native_error';

export type HomeIrohEndpointSnapshot = Readonly<{
    homeServerIdentityId: string;
    canonicalServerUrl: string;
    revision: number;
    endpoint: IrohEndpointDescriptorV1;
}>;

export type HomeIrohEndpointState = Readonly<{
    status: HomeIrohEndpointLifecycleStatus;
    snapshot: HomeIrohEndpointSnapshot | null;
    failureReason: HomeIrohEndpointFailureReason | null;
}>;

const NOT_COMPOSED_STATE: HomeIrohEndpointState = { status: 'not-composed', snapshot: null, failureReason: null };

/**
 * Derives the Iroh acceptor target port from the actual bound Fastify
 * listener. The target host is always the fixed 127.0.0.1 loopback, never the
 * listen host; a missing/unusable port fails the composition closed.
 */
export function resolveHomeIrohAcceptorPort(
    api: { server: { address(): AddressInfo | string | null } },
): number | null {
    return resolveBoundServerListener(api)?.port ?? null;
}

type ActiveHomeIrohEndpoint = Readonly<{
    state: HomeIrohEndpointState;
    endpointHandle: string;
    native: HomeIrohNativeLifecycle;
    configKey: string;
}>;

let activeState: ActiveHomeIrohEndpoint | null = null;
let ensureInFlight: Promise<HomeIrohEndpointState> | null = null;
let lifecycleState: HomeIrohEndpointState = NOT_COMPOSED_STATE;

export type EnsureHomeIrohEndpointParams = Readonly<{
    env: NodeJS.ProcessEnv;
    /** Actual bound Fastify port (`resolveHomeIrohAcceptorPort`), or null when unavailable. */
    apiPort: number | null;
    /**
     * Narrow injected native lifecycle boundary for owner-level tests.
     * Production composition resolves the exact @happier-dev/iroh-native
     * binding and never passes this parameter.
     */
    native?: HomeIrohNativeLifecycle | null;
}>;

/**
 * Idempotently composes the managed Home Iroh endpoint. Repeated compatible
 * calls reuse the one active endpoint handle and acceptor; incompatible
 * configuration fails with a typed `endpoint_config_conflict` IrohError.
 */
export async function ensureHomeIrohEndpoint(params: EnsureHomeIrohEndpointParams): Promise<HomeIrohEndpointState> {
    if (ensureInFlight) return await ensureInFlight;
    ensureInFlight = runEnsure(params)
        .then((state) => {
            lifecycleState = state;
            return state;
        })
        .finally(() => {
            ensureInFlight = null;
        });
    return await ensureInFlight;
}

/** Current carrier-neutral endpoint state for descriptor consumers. */
export async function getHomeIrohEndpointState(): Promise<HomeIrohEndpointState> {
    return lifecycleState;
}

/**
 * Stops the Home Iroh ingress: clears the published in-memory snapshot
 * first, then stops the acceptor, then shuts the endpoint down. Idempotent.
 */
export async function stopHomeIrohEndpoint(): Promise<void> {
    const current = activeState;
    activeState = null;
    lifecycleState = NOT_COMPOSED_STATE;
    if (!current) return;
    try {
        await current.native.stopHomeAcceptor({ endpointHandle: current.endpointHandle });
    } catch (error) {
        log({ module: 'iroh', level: 'warn', detail: error instanceof Error ? error.message : String(error) }, 'Home Iroh acceptor stop failed during shutdown');
    }
    try {
        await current.native.shutdownEndpoint({ endpointHandle: current.endpointHandle });
    } catch (error) {
        log({ module: 'iroh', level: 'warn', detail: error instanceof Error ? error.message : String(error) }, 'Home Iroh endpoint shutdown failed during shutdown');
    }
}

function failed(failureReason: HomeIrohEndpointFailureReason, error?: unknown): HomeIrohEndpointState {
    log(
        {
            module: 'iroh',
            level: 'warn',
            reason: failureReason,
            detail: error instanceof Error ? error.message : undefined,
        },
        `Home Iroh endpoint failed closed: ${failureReason}`,
    );
    return { status: 'failed', snapshot: null, failureReason };
}

function classifyNativeError(error: unknown): HomeIrohEndpointFailureReason {
    // Native errors can cross ESM/module-reset or addon boundaries where
    // `instanceof` identity is not stable. The public error code is the
    // contract; retain the class check only as an additional local signal.
    const structuralCode = typeof error === 'object' && error !== null && 'code' in error
        && typeof error.code === 'string'
        ? error.code
        : null;
    if ((error instanceof IrohError || structuralCode !== null)
        && structuralCode === 'endpoint_config_conflict') {
        return 'endpoint_config_conflict';
    }
    if ((error instanceof IrohError || structuralCode !== null)
        && structuralCode === 'endpoint_key_unavailable') {
        return 'endpoint_key_unavailable';
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('endpoint_key_unavailable')) return 'endpoint_key_unavailable';
    if (message.includes('endpoint_config_conflict')) return 'endpoint_config_conflict';
    return 'native_error';
}

async function cleanupNativeLifecycle(native: HomeIrohNativeLifecycle, endpointHandle: string): Promise<void> {
    try {
        await native.stopHomeAcceptor({ endpointHandle });
    } catch {
        // Best-effort cleanup of a composition that never published.
    }
    try {
        await native.shutdownEndpoint({ endpointHandle });
    } catch {
        // Best-effort cleanup of a composition that never published.
    }
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

async function runEnsure(params: EnsureHomeIrohEndpointParams): Promise<HomeIrohEndpointState> {
    const env = params.env;
    const native = params.native !== undefined ? params.native : loadHomeIrohNativeLifecycle();

    // (1) Strict operator relay configuration. Invalid explicit Iroh config
    // fails the Iroh composition closed without touching native transport.
    let config: HomeIrohEndpointEnvConfig;
    try {
        config = readHomeIrohEndpointConfigFromEnv(env);
    } catch (error) {
        return failed('invalid_iroh_config', error);
    }

    // (2) The stable canonical Home auth audience. This is HAPPIER_PUBLIC_SERVER_URL
    // only — never PUBLIC_URL, the loopback listener, or a client runtime origin.
    const canonicalServerUrl = resolveConfiguredCanonicalServerUrl(env);
    if (!canonicalServerUrl) {
        return failed('canonical_server_url_missing');
    }

    // (3) The actual bound API port; the acceptor target host is fixed loopback.
    const apiPort = params.apiPort;
    if (apiPort === null || !Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
        return failed('api_listen_port_unavailable');
    }

    // (4) Repeated compatible ensure reuses the one active lifecycle.
    const keyPath = resolvePersonalHomeRuntimeLayout({ env }).irohEndpointKeyPath;
    const configKey = JSON.stringify([canonicalServerUrl, config.relayPolicy, [...config.relayUrls], keyPath, apiPort]);
    if (activeState) {
        if (activeState.configKey !== configKey) {
            throw new IrohError('endpoint_config_conflict', 'Home Iroh endpoint is already active with an incompatible configuration');
        }
        return activeState.state;
    }

    // (5) Home identity comes from the existing server identity owner; the
    // Iroh EndpointId is separate transport identity from the native endpoint.
    let homeServerIdentityId: string;
    try {
        homeServerIdentityId = await getOrCreateServerIdentityId(env);
    } catch (error) {
        return failed('server_identity_unavailable', error);
    }

    // (6) Continuity metadata and key-loss detection, before any native call.
    const continuityPath = resolveHomeIrohEndpointContinuityPath(keyPath);
    const continuityResult = await readHomeIrohEndpointContinuity(continuityPath);
    if (continuityResult.state === 'unreadable') {
        return failed('continuity_metadata_unreadable');
    }
    const continuity = continuityResult.state === 'present' ? continuityResult.continuity : null;

    // The persisted descriptor belongs to one stable Home identity. Reusing
    // its endpoint continuity under a different Home would make transport
    // identity appear to authorize a different application identity; require
    // explicit reprovisioning instead.
    if (continuity && continuity.homeServerIdentityId !== homeServerIdentityId) {
        return failed('home_identity_drift');
    }

    const keyExists = await stat(keyPath)
        .then(
            () => true,
            (error: unknown) => {
                if ((error as { code?: unknown })?.code === 'ENOENT') return false;
                throw error;
            },
        )
        .catch(() => null);
    if (keyExists === null) {
        return failed('endpoint_key_unavailable');
    }
    // A previously provisioned Home whose endpoint key is gone must never
    // silently rotate; explicit operator re-provisioning is required.
    if (continuity && !keyExists) {
        return failed('endpoint_key_lost');
    }

    // (7) Native carrier availability. Relay policy and URLs configure Iroh
    // when present; they are not an implicit required-mode switch. Keep the
    // ordinary Home server runnable and publish no descriptor when the
    // optional addon is absent.
    if (!native) {
        log(
            { module: 'iroh', level: 'warn' },
            'Native Iroh transport is unavailable on this target; the Home remains reachable on its ordinary HTTPS listener.',
        );
        return { status: 'unavailable', snapshot: null, failureReason: null };
    }

    // (8) One persistent endpoint keyed by the canonical managed layout path.
    // A missing key is created by the native store on first provisioning; a
    // corrupt key fails closed and is never rotated.
    let created: { endpointHandle: string; endpointId: string };
    try {
        const endpointHandle = await native.createEndpoint({
            keyPath,
            relayPolicy: config.relayPolicy,
            relayUrls: config.relayUrls,
            capProfile: 'homeInteractive',
        });
        created = { endpointHandle: endpointHandle.endpointHandle, endpointId: endpointHandle.endpointId };
    } catch (error) {
        return failed(classifyNativeError(error), error);
    }

    // (9) The endpoint must report active status; direct addresses come from
    // the native endpoint only.
    const endpointStatus = await native.getEndpointStatus({ endpointHandle: created.endpointHandle }).catch(() => null);
    if (!endpointStatus || !endpointStatus.active || endpointStatus.endpointId !== created.endpointId) {
        await cleanupNativeLifecycle(native, created.endpointHandle);
        return failed('endpoint_not_active');
    }

    // (10) Identity drift: the same key must always produce the same
    // EndpointId as the persisted continuity metadata.
    if (continuity && continuity.endpointId !== created.endpointId) {
        await cleanupNativeLifecycle(native, created.endpointHandle);
        return failed('endpoint_identity_drift');
    }

    // (11) Normalize deterministically, then parse through the protocol-owned
    // Iroh parser before the acceptor binds or anything is published.
    const directAddresses = [...new Set(endpointStatus.directAddresses.map((entry) => entry.trim()).filter((entry) => entry.length > 0))]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const relayUrls = [...config.relayUrls];
    let endpoint: IrohEndpointDescriptorV1;
    try {
        endpoint = parseIrohEndpointDescriptorV1({
            endpointId: created.endpointId,
            ...(relayUrls.length > 0 ? { relayUrls } : {}),
            ...(directAddresses.length > 0 ? { directAddresses } : {}),
        });
    } catch (error) {
        await cleanupNativeLifecycle(native, created.endpointHandle);
        return failed('descriptor_invalid', error);
    }

    // (12) One acceptor, fixed to the loopback target and the bound API port.
    const acceptor = await native.startHomeAcceptor({
        endpointHandle: created.endpointHandle,
        targetHost: HOME_IROH_ACCEPTOR_TARGET_HOST,
        targetPort: apiPort,
    }).catch(() => null);
    if (!acceptor || !acceptor.status.running) {
        await cleanupNativeLifecycle(native, created.endpointHandle);
        return failed('acceptor_not_running');
    }

    // (13) Positive monotonic descriptor revision across restarts.
    const unchanged = continuity !== null
        && continuity.homeServerIdentityId === homeServerIdentityId
        && continuity.canonicalServerUrl === canonicalServerUrl
        && continuity.endpointId === created.endpointId
        && sameStrings(continuity.relayUrls, relayUrls)
        && sameStrings(continuity.directAddresses, directAddresses);
    const revision = unchanged && continuity ? continuity.revision : (continuity?.revision ?? 0) + 1;

    // (14) Durable continuity before publication.
    try {
        await writeHomeIrohEndpointContinuity(continuityPath, {
            v: 1,
            homeServerIdentityId,
            canonicalServerUrl,
            endpointId: created.endpointId,
            relayUrls,
            directAddresses,
            revision,
        });
    } catch (error) {
        await cleanupNativeLifecycle(native, created.endpointHandle);
        return failed('continuity_write_failed', error);
    }

    // (15) Publish readiness only after the endpoint is active and the fixed
    // acceptor started.
    const state: HomeIrohEndpointState = {
        status: 'active',
        snapshot: {
            homeServerIdentityId,
            canonicalServerUrl,
            revision,
            endpoint,
        },
        failureReason: null,
    };
    activeState = { state, endpointHandle: created.endpointHandle, native, configKey };
    log(
        { module: 'iroh', endpointId: created.endpointId, revision },
        `Home Iroh endpoint active; acceptor targeting ${HOME_IROH_ACCEPTOR_TARGET_HOST}:${apiPort}`,
    );
    return state;
}
