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

export type MaterializeHomeIrohEndpointDescriptorParams = Readonly<{
    env: NodeJS.ProcessEnv;
    /** Public outer descriptor revision currently owned by the source Home. */
    sourceDescriptorRevision: number;
    /** Test-only native lifecycle boundary; production resolves the packaged binding. */
    native?: HomeIrohNativeLifecycle | null;
}>;

export type HomeIrohEndpointMaterializationResult =
    | Readonly<{
        status: 'ready';
        /** Lane 02 must assign the outer descriptor a strictly greater revision. */
        minimumOuterRevisionExclusive: number;
        endpoint: IrohEndpointDescriptorV1;
    }>
    | Readonly<{
        status: 'unavailable' | 'failed';
        failureReason: HomeIrohEndpointFailureReason | null;
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

/**
 * Materializes the destination's fresh persistent endpoint identity and public
 * endpoint subdescriptor without starting a Home acceptor. Relocation calls
 * this only while the destination service is stopped and quarantined. The
 * source's public revision is retained solely as a lower bound; this owner
 * neither composes nor publishes the outer HomeConnectionDescriptorV1.
 */
export async function materializeHomeIrohEndpointDescriptor(
    params: MaterializeHomeIrohEndpointDescriptorParams,
): Promise<HomeIrohEndpointMaterializationResult> {
    if (!Number.isSafeInteger(params.sourceDescriptorRevision)
        || params.sourceDescriptorRevision < 1
        || params.sourceDescriptorRevision >= Number.MAX_SAFE_INTEGER) {
        return { status: 'failed', failureReason: 'descriptor_invalid' };
    }
    if (activeState) {
        return { status: 'failed', failureReason: 'endpoint_config_conflict' };
    }

    const native = params.native !== undefined ? params.native : loadHomeIrohNativeLifecycle();
    let config: HomeIrohEndpointEnvConfig;
    try {
        config = readHomeIrohEndpointConfigFromEnv(params.env);
    } catch (error) {
        const state = failed('invalid_iroh_config', error);
        return { status: 'failed', failureReason: state.failureReason };
    }
    const canonicalServerUrl = resolveConfiguredCanonicalServerUrl(params.env);
    if (!canonicalServerUrl) {
        const state = failed('canonical_server_url_missing');
        return { status: 'failed', failureReason: state.failureReason };
    }
    const keyPath = resolvePersonalHomeRuntimeLayout({ env: params.env }).irohEndpointKeyPath;
    const provisioned = await provisionHomeIrohEndpoint({
        env: params.env,
        native,
        config,
        canonicalServerUrl,
        keyPath,
        revisionFloor: params.sourceDescriptorRevision,
    });
    if (provisioned.kind === 'terminal') {
        return {
            status: provisioned.state.status === 'unavailable' ? 'unavailable' : 'failed',
            failureReason: provisioned.state.failureReason,
        };
    }

    try {
        await provisioned.native.shutdownEndpoint({ endpointHandle: provisioned.endpointHandle });
    } catch (error) {
        const state = failed('native_error', error);
        return { status: 'failed', failureReason: state.failureReason };
    }
    return {
        status: 'ready',
        minimumOuterRevisionExclusive: Math.max(
            params.sourceDescriptorRevision,
            provisioned.revision - 1,
        ),
        endpoint: provisioned.endpoint,
    };
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

type ProvisionedHomeIrohEndpoint = Readonly<{
    kind: 'ready';
    native: HomeIrohNativeLifecycle;
    endpointHandle: string;
    homeServerIdentityId: string;
    endpoint: IrohEndpointDescriptorV1;
    revision: number;
}>;

type ProvisionHomeIrohEndpointResult =
    | ProvisionedHomeIrohEndpoint
    | Readonly<{ kind: 'terminal'; state: HomeIrohEndpointState }>;

async function provisionHomeIrohEndpoint(params: Readonly<{
    env: NodeJS.ProcessEnv;
    native: HomeIrohNativeLifecycle | null;
    config: HomeIrohEndpointEnvConfig;
    canonicalServerUrl: string;
    keyPath: string;
    revisionFloor: number;
}>): Promise<ProvisionHomeIrohEndpointResult> {
    let homeServerIdentityId: string;
    try {
        homeServerIdentityId = await getOrCreateServerIdentityId(params.env);
    } catch (error) {
        return { kind: 'terminal', state: failed('server_identity_unavailable', error) };
    }

    const continuityPath = resolveHomeIrohEndpointContinuityPath(params.keyPath);
    const continuityResult = await readHomeIrohEndpointContinuity(continuityPath);
    if (continuityResult.state === 'unreadable') {
        return { kind: 'terminal', state: failed('continuity_metadata_unreadable') };
    }
    const continuity = continuityResult.state === 'present' ? continuityResult.continuity : null;
    if (continuity && continuity.homeServerIdentityId !== homeServerIdentityId) {
        return { kind: 'terminal', state: failed('home_identity_drift') };
    }

    const keyExists = await stat(params.keyPath)
        .then(
            () => true,
            (error: unknown) => {
                if ((error as { code?: unknown })?.code === 'ENOENT') return false;
                throw error;
            },
        )
        .catch(() => null);
    if (keyExists === null) {
        return { kind: 'terminal', state: failed('endpoint_key_unavailable') };
    }
    if (continuity && !keyExists) {
        return { kind: 'terminal', state: failed('endpoint_key_lost') };
    }

    if (!params.native) {
        log(
            { module: 'iroh', level: 'warn' },
            'Native Iroh transport is unavailable on this target; the Home remains reachable on its ordinary HTTPS listener.',
        );
        return {
            kind: 'terminal',
            state: { status: 'unavailable', snapshot: null, failureReason: null },
        };
    }

    let created: { endpointHandle: string; endpointId: string };
    try {
        const endpointHandle = await params.native.createEndpoint({
            keyPath: params.keyPath,
            relayPolicy: params.config.relayPolicy,
            relayUrls: params.config.relayUrls,
            capProfile: 'homeInteractive',
        });
        created = { endpointHandle: endpointHandle.endpointHandle, endpointId: endpointHandle.endpointId };
    } catch (error) {
        return { kind: 'terminal', state: failed(classifyNativeError(error), error) };
    }

    const endpointStatus = await params.native.getEndpointStatus({ endpointHandle: created.endpointHandle }).catch(() => null);
    if (!endpointStatus || !endpointStatus.active || endpointStatus.endpointId !== created.endpointId) {
        await cleanupNativeLifecycle(params.native, created.endpointHandle);
        return { kind: 'terminal', state: failed('endpoint_not_active') };
    }
    if (continuity && continuity.endpointId !== created.endpointId) {
        await cleanupNativeLifecycle(params.native, created.endpointHandle);
        return { kind: 'terminal', state: failed('endpoint_identity_drift') };
    }

    const directAddresses = [...new Set(endpointStatus.directAddresses.map((entry) => entry.trim()).filter((entry) => entry.length > 0))]
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const relayUrls = [...params.config.relayUrls];
    let endpoint: IrohEndpointDescriptorV1;
    try {
        endpoint = parseIrohEndpointDescriptorV1({
            endpointId: created.endpointId,
            ...(relayUrls.length > 0 ? { relayUrls } : {}),
            ...(directAddresses.length > 0 ? { directAddresses } : {}),
        });
    } catch (error) {
        await cleanupNativeLifecycle(params.native, created.endpointHandle);
        return { kind: 'terminal', state: failed('descriptor_invalid', error) };
    }

    const unchanged = continuity !== null
        && continuity.homeServerIdentityId === homeServerIdentityId
        && continuity.canonicalServerUrl === params.canonicalServerUrl
        && continuity.endpointId === created.endpointId
        && sameStrings(continuity.relayUrls, relayUrls)
        && sameStrings(continuity.directAddresses, directAddresses);
    const revision = unchanged && continuity && continuity.revision > params.revisionFloor
        ? continuity.revision
        : Math.max(continuity?.revision ?? 0, params.revisionFloor) + 1;

    try {
        await writeHomeIrohEndpointContinuity(continuityPath, {
            v: 1,
            homeServerIdentityId,
            canonicalServerUrl: params.canonicalServerUrl,
            endpointId: created.endpointId,
            relayUrls,
            directAddresses,
            revision,
        });
    } catch (error) {
        await cleanupNativeLifecycle(params.native, created.endpointHandle);
        return { kind: 'terminal', state: failed('continuity_write_failed', error) };
    }

    return {
        kind: 'ready',
        native: params.native,
        endpointHandle: created.endpointHandle,
        homeServerIdentityId,
        endpoint,
        revision,
    };
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

    // (2) The stable canonical Home auth audience. This is configured through
    // HAPPIER_CANONICAL_SERVER_URL, with a bounded explicit legacy public-URL
    // fallback — never PUBLIC_URL, the loopback listener, or a client runtime origin.
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

    const provisioned = await provisionHomeIrohEndpoint({
        env,
        native,
        config,
        canonicalServerUrl,
        keyPath,
        revisionFloor: 0,
    });
    if (provisioned.kind === 'terminal') return provisioned.state;

    // (12) One acceptor, fixed to the loopback target and the bound API port.
    const acceptor = await provisioned.native.startHomeAcceptor({
        endpointHandle: provisioned.endpointHandle,
        targetHost: HOME_IROH_ACCEPTOR_TARGET_HOST,
        targetPort: apiPort,
    }).catch(() => null);
    if (!acceptor || !acceptor.status.running) {
        await cleanupNativeLifecycle(provisioned.native, provisioned.endpointHandle);
        return failed('acceptor_not_running');
    }

    // (15) Publish readiness only after the endpoint is active and the fixed
    // acceptor started.
    const state: HomeIrohEndpointState = {
        status: 'active',
        snapshot: {
            homeServerIdentityId: provisioned.homeServerIdentityId,
            canonicalServerUrl,
            revision: provisioned.revision,
            endpoint: provisioned.endpoint,
        },
        failureReason: null,
    };
    activeState = {
        state,
        endpointHandle: provisioned.endpointHandle,
        native: provisioned.native,
        configKey,
    };
    log(
        {
            module: 'iroh',
            endpointId: provisioned.endpoint.endpointId,
            revision: provisioned.revision,
        },
        `Home Iroh endpoint active; acceptor targeting ${HOME_IROH_ACCEPTOR_TARGET_HOST}:${apiPort}`,
    );
    return state;
}
