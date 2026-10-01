import {
  isTokenOnlyAuthCredentials,
  TokenStorage,
  type AuthCredentials,
} from '@/auth/storage/tokenStorage';
import { createEncryptionFromAuthCredentials } from '@/auth/encryption/createEncryptionFromAuthCredentials';
import type { Encryption } from '@/sync/encryption/encryption';
import {
  areServerProfileIdentifiersEquivalent,
  getServerProfileById,
  resolveServerProfileScopeIdForIdentifier,
} from '@/sync/domains/server/serverProfiles';
import {
  getAppliedActiveServerSnapshot,
  isAppliedActiveServerRuntimeAvailable,
} from '@/sync/runtime/orchestration/connectionManager';
import type { HomeCarrier } from '@/sync/runtime/homeCarrier';
import { parseToken } from '@/utils/auth/parseToken';
import {
  readRegisteredStorageState,
  subscribeRegisteredStorageState,
} from '@/sync/domains/state/storageStateReaderBridge';
import {
  resolveServerScopedTransport,
  ServerScopedTransportUnavailableError,
} from './resolveServerScopedTransport';

export { ServerScopedTransportUnavailableError };

import { DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS } from './serverScopedRpcTypes';
import { isEmbedWindowContext } from '@/embed/isEmbedWindowContext';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';

function normalizeId(raw: unknown): string {
  return String(raw ?? '').trim();
}

export type ResolvedServerAccountRequestContext =
  | Readonly<{ scope: 'active'; timeoutMs: number }>
  | Readonly<{
      scope: 'scoped';
      timeoutMs: number;
      targetServerId: string;
      targetServerUrl: string;
      targetAccountId: string;
      token: string;
      /** Present for contexts produced by the runtime; optional for injected adapters. */
      credentials?: AuthCredentials;
      encryption: Encryption | null;
      runtimeOrigin?: string;
      carrier?: 'https' | 'iroh';
      /** Semantic carrier for a Home with no reachable URL origin (browser Iroh). */
      homeCarrier?: HomeCarrier;
      release?: () => Promise<void>;
    }>;

async function buildScopedContext(params: Readonly<{
  serverId: string;
  serverUrl: string;
  profile?: Readonly<{
    serverUrl: string;
    canonicalServerUrl?: string | null;
    publicServerUrl?: string | null;
    serverIdentityId?: string | null;
    homeConnectionDescriptor?: import('@happier-dev/protocol').HomeConnectionDescriptorV1;
  }>;
  timeoutMs: number;
}>): Promise<Extract<ResolvedServerAccountRequestContext, { scope: 'scoped' }>> {
  const credentials = await TokenStorage.getCredentialsForServerUrl(params.serverUrl, { serverId: params.serverId });
  if (!credentials) {
    throw new Error(`No authentication credentials for target server "${params.serverId}"`);
  }

  const encryption = isTokenOnlyAuthCredentials(credentials)
    ? null
    : await createEncryptionFromAuthCredentials(credentials);
  const transport = await resolveServerScopedTransport({
    profile: params.profile ?? { serverUrl: params.serverUrl },
    credentials,
  });
  return {
    scope: 'scoped',
    timeoutMs: params.timeoutMs,
    targetServerId: params.serverId,
    targetServerUrl: transport.canonicalServerUrl,
    targetAccountId: parseToken(credentials.token),
    token: credentials.token,
    credentials,
    encryption,
    runtimeOrigin: transport.runtimeOrigin,
    carrier: transport.carrier,
    ...(transport.homeCarrier ? { homeCarrier: transport.homeCarrier } : {}),
    release: transport.release,
  };
}

/**
 * Whether the connection supervisor has concluded the active Home is not answering: the endpoint
 * status the connection summary (footer status, `HomeReachabilityGate`) reads as "unavailable".
 */
function isActiveHomeUnreachable(): boolean {
  return readRegisteredStorageState()?.endpointStatus === 'offline';
}

/**
 * Settles a scoped context for the active Home as soon as that Home is known to be unreachable,
 * instead of waiting on a carrier dial that may never answer. The decision is the connection
 * supervisor's (no timer here). A context that is built after the caller was told it failed is
 * released, so its carrier does not leak; a later caller (Retry) resolves afresh.
 */
async function settleWhenActiveHomeUnreachable(
  build: () => Promise<Extract<ResolvedServerAccountRequestContext, { scope: 'scoped' }>>,
): Promise<Extract<ResolvedServerAccountRequestContext, { scope: 'scoped' }>> {
  if (isActiveHomeUnreachable()) throw new ServerScopedTransportUnavailableError();
  let unsubscribe: (() => void) | null = null;
  let abandoned = false;
  const pending = build();
  const unreachable = new Promise<never>((_, reject) => {
    unsubscribe = subscribeRegisteredStorageState((state) => {
      if (state.endpointStatus !== 'offline') return;
      abandoned = true;
      reject(new ServerScopedTransportUnavailableError());
    });
  });
  try {
    return await Promise.race([pending, unreachable]);
  } finally {
    (unsubscribe as (() => void) | null)?.();
    if (abandoned) {
      pending.then(
        (context) => { void context.release?.().catch(() => undefined); },
        () => undefined,
      );
    }
  }
}

export async function resolveServerAccountRequestContext(params: Readonly<{
  serverId?: string | null;
  timeoutMs?: number;
  preferScoped?: boolean;
}>): Promise<ResolvedServerAccountRequestContext> {
  const targetServerId = normalizeId(params.serverId);
  const timeoutMs = typeof params.timeoutMs === 'number' && params.timeoutMs > 0
    ? params.timeoutMs
    : DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS;
  if (isEmbedWindowContext()) {
    const embed = getSyncSingleton().getEmbedSessionRequestContext();
    if (!embed || targetServerId && targetServerId !== embed.serverId) throw new ServerScopedTransportUnavailableError();
    return { scope: 'active', timeoutMs };
  }
  const activeSnapshot = getAppliedActiveServerSnapshot();

  const activeServerId = normalizeId(activeSnapshot.serverId);
  const targetsActiveServer = !targetServerId || areServerProfileIdentifiersEquivalent(targetServerId, activeServerId);
  if (targetsActiveServer && params.preferScoped !== true && isAppliedActiveServerRuntimeAvailable()) {
    return { scope: 'active', timeoutMs };
  }

  if (targetsActiveServer) {
    return await settleWhenActiveHomeUnreachable(() => buildScopedContext({
      serverId: activeServerId,
      serverUrl: activeSnapshot.serverUrl,
      timeoutMs,
      profile: getServerProfileById(activeServerId) ?? { serverUrl: activeSnapshot.serverUrl },
    }));
  }

  const resolvedTargetServerId = resolveServerProfileScopeIdForIdentifier(targetServerId);
  const targetProfile = getServerProfileById(resolvedTargetServerId);
  if (!targetProfile) {
    throw new Error(`Target server profile not found for serverId "${resolvedTargetServerId}"`);
  }

  return await buildScopedContext({
    serverId: resolvedTargetServerId,
    serverUrl: targetProfile.serverUrl,
    timeoutMs,
    profile: targetProfile,
  });
}
