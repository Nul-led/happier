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
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import type { HomeCarrier } from '@/sync/runtime/homeCarrier';
import { parseToken } from '@/utils/auth/parseToken';
import {
  resolveServerScopedTransport,
} from './resolveServerScopedTransport';

export { ServerScopedTransportUnavailableError } from './resolveServerScopedTransport';

import { DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS } from './serverScopedRpcTypes';

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

export async function resolveServerAccountRequestContext(params: Readonly<{
  serverId?: string | null;
  timeoutMs?: number;
  preferScoped?: boolean;
}>): Promise<ResolvedServerAccountRequestContext> {
  const targetServerId = normalizeId(params.serverId);
  const timeoutMs = typeof params.timeoutMs === 'number' && params.timeoutMs > 0
    ? params.timeoutMs
    : DEFAULT_SERVER_SCOPED_RPC_TIMEOUT_MS;
  const activeSnapshot = getActiveServerSnapshot();

  const activeServerId = normalizeId(activeSnapshot.serverId);
  const targetsActiveServer = !targetServerId || areServerProfileIdentifiersEquivalent(targetServerId, activeServerId);
  if (targetsActiveServer) {
    if (params.preferScoped === true) {
      return await buildScopedContext({
        serverId: activeServerId,
        serverUrl: activeSnapshot.serverUrl,
        timeoutMs,
        profile: getServerProfileById(activeServerId) ?? { serverUrl: activeSnapshot.serverUrl },
      });
    }
    return { scope: 'active', timeoutMs };
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
