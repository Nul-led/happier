import type { ManagedServiceSpec } from '@happier-dev/plugin-sdk/managed-services';

import { OPENCODE_SERVER_PASSWORD_ENV_KEY } from './endpoint.js';
import { buildOpenCodePermissionEnv } from '../../permissions/policy.js';
import {
  OPENCODE_PROVIDER_OWNED_ENV_KEYS,
} from '../../providerBinding/adapter.js';
import {
  OPEN_CODE_REQUEST_AUTH_CAPABILITY_PATH_ENV,
} from '../../auth/services/requestAuth/env.js';
import { OPEN_CODE_SYSTEM_TOOL_ID } from '../../systemTool.js';
import { OPEN_CODE_MANAGED_SERVER_STARTUP_TIMEOUT_MS } from './timeoutPolicy.js';
import { openCodeServerHealthPath, type OpenCodeServerDialect } from './dialect.js';

/**
 * The complete ambient environment an owned `opencode serve` child may inherit.
 * The host replaces rather than merges the child environment, so this list is
 * the whole inheritance.
 *
 * `XDG_DATA_HOME` and `OPENCODE_DB` are deliberately absent and must stay
 * absent: OpenCode resolves its data root as
 * `(XDG_DATA_HOME ?? os.homedir() + '/.local/share') + '/opencode'` and its
 * database as `<data root>/opencode.db`. Forwarding or synthesizing either key
 * — for instance toward plugin storage, by analogy with the managed Provider
 * filesystem roots — repoints the server at an empty database, and every read
 * silently returns zero sessions instead of the user's corpus.
 */
export const OPENCODE_CHILD_LAUNCH_ENV_KEYS = Object.freeze([
  ...OPENCODE_PROVIDER_OWNED_ENV_KEYS,
  'XDG_CONFIG_HOME',
  OPEN_CODE_REQUEST_AUTH_CAPABILITY_PATH_ENV,
] as const);

/**
 * Environment keys that would repoint the owned server away from the user's
 * OpenCode data root. Exported so the negative requirement is assertable rather
 * than only documented.
 */
export const OPENCODE_DATA_ROOT_OVERRIDE_ENV_KEYS = Object.freeze([
  'XDG_DATA_HOME',
  'OPENCODE_DB',
  'HOME',
] as const);

export function buildOpenCodeManagedLaunchEnvironment(
  env: Readonly<Record<string, string>> | undefined,
  permissionMode: string | null | undefined,
  providerConfigContent: string | undefined,
  additionalEnv?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze({
    ...Object.fromEntries(OPENCODE_CHILD_LAUNCH_ENV_KEYS.flatMap((key) => (
      typeof env?.[key] === 'string' ? [[key, env[key]]] : []
    ))),
    ...(providerConfigContent === undefined
      ? {}
      : { OPENCODE_CONFIG_CONTENT: providerConfigContent }),
    ...buildOpenCodePermissionEnv(permissionMode),
    ...(additionalEnv ?? {}),
  });
}

/**
 * The one owned-`opencode serve` specification. It carries no Session identity
 * and no open request: a spawned server is a data-root-scoped process, so the
 * Session runtime and the External Sessions browse surface describe the same
 * process the same way and cannot drift apart.
 *
 * `dialect` names the generation of the executable the host will resolve, which
 * is what decides the readiness route (`openCodeServerHealthPath`). It is
 * required and has no default: an `opencode2` child mounts no `/global/*` at
 * all, so a caller that guessed the legacy route here would leave a beta-only
 * install permanently unhealthy and its sessions unopenable. Every caller —
 * the Session runtime assembly and the External Sessions browse surface —
 * resolves it from the host's system-tool resolution through the one owner,
 * `resolveOpenCodeManagedServerDialect`.
 */
export function buildOpenCodeManagedServerSpawnSpec(params: Readonly<{
  id: string;
  dialect: OpenCodeServerDialect;
  env?: Readonly<Record<string, string>>;
  permissionMode?: string | null;
  providerConfigContent?: string;
  additionalEnv?: Readonly<Record<string, string>>;
  durableLog?: boolean;
}>): ManagedServiceSpec {
  return {
    id: params.id,
    mode: {
      kind: 'spawn',
      launch: {
        executable: {
          kind: 'systemTool',
          id: OPEN_CODE_SYSTEM_TOOL_ID,
        },
        args: [
          'serve',
          '--hostname',
          '127.0.0.1',
        ],
        cwd: { root: 'workspace', relativePath: '' },
        env: buildOpenCodeManagedLaunchEnvironment(
          params.env,
          params.permissionMode,
          params.providerConfigContent,
          params.additionalEnv,
        ),
      },
      endpoint: {
        kind: 'assignAndInject',
        host: '127.0.0.1',
        port: { kind: 'allocated' },
        inject: { argument: '--port' },
      },
    },
    healthCheck: {
      kind: 'http',
      target: {
        kind: 'servicePath',
        path: openCodeServerHealthPath(params.dialect),
      },
      timeoutMs: 5_000,
    },
    clientAccess: {
      kind: 'hostBasic',
      // OpenCode's Basic-auth middleware defaults the username to `opencode`
      // and is enabled solely by the password environment variable, so the host
      // injects only the password and must not send a username variable.
      username: 'opencode',
      injectPasswordEnvironmentKey: OPENCODE_SERVER_PASSWORD_ENV_KEY,
    },
    healthPolicy: {
      intervalMs: 10_000,
      consecutiveFailures: 3,
    },
    startupTimeoutMs: OPEN_CODE_MANAGED_SERVER_STARTUP_TIMEOUT_MS,
    // Durable per-server log: tee post-spawn stdout/stderr to a secret-redacted log file for later
    // incident diagnosis. Handled generically by the host (shared with other managed-server
    // providers); the OpenCode plugin only opts in.
    ...(params.durableLog === false ? {} : { durableLog: { enabled: true } }),
  };
}
