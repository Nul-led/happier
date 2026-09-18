import { createHash } from 'node:crypto';

import {
  readManagedServiceEndpointUrl,
  type ManagedServiceSpec,
} from '@happier-dev/plugin-sdk/managed-services';
import type {
  AgentExternalSessionsManagedEndpointServiceRequest,
} from '@happier-dev/plugin-sdk/sessions/external';

import { buildOpenCodeManagedServerAttachSpec } from '../../../runtime/server/attachSpec.js';
import { buildOpenCodeManagedServerSpawnSpec } from '../../../runtime/server/spawnSpec.js';
import type { OpenCodeServerDialect } from '../../../runtime/server/dialect.js';
import {
  resolveOpenCodeManagedServerDialect,
  type OpenCodeSystemToolResolver,
} from '../../../runtime/server/managedServerDialect.js';
import {
  projectOpenCodeExternalSessionSource,
  type OpenCodeExternalSessionSource,
} from './client.js';

export const OPENCODE_EXTERNAL_SESSIONS_SERVICE_ID = 'opencode-external-sessions-server';

/**
 * A generation-scoped browse surface can see several configured servers at
 * once, and the managed-services owner keys one supervised service per service
 * id. A stable per-origin suffix keeps two attached servers from colliding on
 * one entry without inventing a registry to track them.
 */
function attachServiceId(baseUrl: string): string {
  const digest = createHash('sha256').update(baseUrl).digest('hex').slice(0, 32);
  return `${OPENCODE_EXTERNAL_SESSIONS_SERVICE_ID}/attach/${digest}`;
}

/**
 * The shared endpoint owner admits only HTTPS remote endpoints and HTTP
 * loopback. OpenCode keeps the admitted request base path, but drops query and
 * fragment before either the managed-service identity or the request path can
 * observe them.
 */
function normalizeAttachBaseUrl(value: string): string | null {
  const read = readManagedServiceEndpointUrl(value, {
    hostPolicy: 'userDeclaredAttach',
    allowSearch: true,
    allowHash: true,
  });
  if (!read.ok) return null;
  const url = new URL(read.endpoint.baseUrl);
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/u, '');
}

/**
 * Whether this source asks Happier to own the process that serves its reads.
 *
 * One test for that question, shared by the service declaration below and the
 * request-dialect resolver, so "Happier spawned this server" cannot be answered
 * one way when the readiness route is chosen and another way when the reads are
 * routed.
 */
function readOwnedBrowseServer(
  source: OpenCodeExternalSessionSource,
): Readonly<{ owned: true; directory: string | null }> | Readonly<{ owned: false }> {
  const baseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : '';
  if (baseUrl || source.managedEndpoint !== true) return { owned: false };
  const directory = typeof source.directory === 'string' ? source.directory.trim() : '';
  return { owned: true, directory: directory || null };
}

/**
 * Declares the OpenCode server that serves External Sessions reads.
 *
 * Both shapes are managed services, which is the point: browse and Session
 * runtime reach an OpenCode server through one owner, one credential
 * mechanism and one transport, whether Happier owns the process or the user
 * does.
 *
 * - No configured base URL — Happier spawns a data-root-scoped server and
 *   mints its own credential. Its readiness route comes from the executable the
 *   host resolves for that spawn, through the same owner the Session runtime
 *   uses, because an `opencode2` child answers `/api/health` and mounts no
 *   `/global/*` at all.
 * - A configured base URL — the user's own process; Happier attaches to it and
 *   the host applies the password the user recorded, if any. Happier resolved no
 *   executable for it, so the attached declaration keeps the proven legacy route
 *   and this resolver is not consulted.
 */
export async function resolveOpenCodeExternalSessionsManagedService(
  request: AgentExternalSessionsManagedEndpointServiceRequest,
): Promise<ManagedServiceSpec | null> {
  const source = projectOpenCodeExternalSessionSource(request.source);
  if (!source) return null;
  const baseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : '';
  if (baseUrl) {
    const normalizedBaseUrl = normalizeAttachBaseUrl(baseUrl);
    if (!normalizedBaseUrl) return null;
    return buildOpenCodeManagedServerAttachSpec({
      id: attachServiceId(normalizedBaseUrl),
      baseUrl: normalizedBaseUrl,
    });
  }
  const owned = readOwnedBrowseServer(source);
  if (!owned.owned) return null;
  return buildOpenCodeManagedServerSpawnSpec({
    id: OPENCODE_EXTERNAL_SESSIONS_SERVICE_ID,
    dialect: await resolveOpenCodeExternalSessionsDialect({
      source,
      exec: request.exec,
      signal: request.signal,
    }),
    additionalEnv: {
      // A read-only browse surface must never prune the user's OpenCode
      // corpus, and `opencode serve` prunes on start by default.
      OPENCODE_DISABLE_PRUNE: '1',
    },
  });
}

/**
 * Which OpenCode surface the External Sessions reads for this source must speak.
 *
 * Same fact, same owner as the readiness route above: for a server Happier
 * spawns, the resolved executable decides both, so a browse-owned `opencode2`
 * child is declared healthy on `/api/health` *and* read over `/api/*`.
 *
 * A server Happier did not spawn stays on V1. The `/api/*` surface also ships on
 * current stable servers, so its presence would not prove the V2 session engine
 * is behind it, and this surface has no launch-environment opt-in to say
 * otherwise — an attached server is read the one way that is proven against
 * every released OpenCode server.
 */
export async function resolveOpenCodeExternalSessionsDialect(params: Readonly<{
  source: OpenCodeExternalSessionSource;
  exec: Readonly<{ systemTools: OpenCodeSystemToolResolver }>;
  signal?: AbortSignal;
}>): Promise<OpenCodeServerDialect> {
  const owned = readOwnedBrowseServer(params.source);
  if (!owned.owned) return 'v1';
  return await resolveOpenCodeManagedServerDialect({
    exec: params.exec,
    ...(owned.directory ? { cwd: owned.directory } : {}),
    ...(params.signal ? { signal: params.signal } : {}),
  });
}
