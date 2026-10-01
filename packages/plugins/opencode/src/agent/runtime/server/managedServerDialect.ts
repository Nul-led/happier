import {
  openCodeServerHealthPath,
  readOpenCodeManagedServerDialect,
  type OpenCodeServerDialect,
} from './dialect.js';
import type { ExecService } from '@happier-dev/plugin-sdk/exec';
import {
  OPEN_CODE_SYSTEM_TOOL_ID,
  OPEN_CODE_STABLE_SYSTEM_TOOL_ID,
  OPEN_CODE_V2_SYSTEM_TOOL_ID,
  type OpenCodeSystemToolId,
} from '../../systemTool.js';

/**
 * The one thing any OpenCode surface needs from the host's exec service to
 * declare or talk to an owned server: where the OpenCode system tool actually
 * resolved. Narrower than `ExecService` on purpose — a readiness decision needs
 * no process handle and no launcher — and structurally satisfied by it, so the
 * Session runtime context and an External Sessions invocation both fit.
 */
export type OpenCodeSystemToolResolver = Readonly<{
  resolve(request: Readonly<{
    toolId: string;
    purpose: string;
    cwd?: string;
    signal?: AbortSignal;
  }>): Promise<Readonly<{ executablePath: string; executable?: import('@happier-dev/plugin-sdk/managed-services').ManagedExecutableRef }>>;
}>;

/**
 * The subset of the plugin logger this resolver reports its decision on. It is
 * optional because not every host surface that declares a managed OpenCode
 * server carries a logger; see `resolveOpenCodeManagedServerDialect`.
 */
export type OpenCodeManagedServerDialectLogger = Readonly<{
  info(message: string, detail?: Readonly<Record<string, unknown>>): void;
  warn(message: string, detail?: Readonly<Record<string, unknown>>): void;
}>;

/**
 * Which OpenCode generation an *owned* server will be. An explicit user
 * V2 selection is authoritative. Auto and Stable both inspect the resolved
 * `opencode --version` major: Stable selects that executable, not a promise
 * that it still serves V1. The `opencode2` preview name identifies V2 directly.
 *
 * This is the single owner of that question for every surface that spawns
 * `opencode serve`: the Session runtime and the External Sessions browse
 * surface. Both the readiness route the managed-service specification declares
 * and the request routes used against the running server derive from this one
 * resolution, so either V2 generation cannot be paired with V1 requests.
 *
 * A resolution failure is not fatal here — the supervise call is about to fail
 * on the same missing executable, with the resolver's own message — so this
 * keeps the proven legacy route and says so when a logger is available.
 */
export async function resolveOpenCodeManagedServerDialect(params: Readonly<{
  exec: Readonly<{ systemTools: OpenCodeSystemToolResolver; run?: ExecService['run'] }>;
  cwd?: string;
  signal?: AbortSignal;
  logger?: OpenCodeManagedServerDialectLogger;
  systemToolId: OpenCodeSystemToolId;
}>): Promise<Readonly<{ dialect: OpenCodeServerDialect; healthPath: string }>> {
  try {
    const resolved = await params.exec.systemTools.resolve({
      toolId: params.systemToolId,
      purpose: 'Choose the OpenCode managed server readiness route',
      ...(params.cwd ? { cwd: params.cwd } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    let dialect = params.systemToolId === OPEN_CODE_V2_SYSTEM_TOOL_ID
      ? 'v2'
      : params.systemToolId === OPEN_CODE_STABLE_SYSTEM_TOOL_ID
        ? 'v1'
        : readOpenCodeManagedServerDialect(resolved.executablePath);
    if (params.systemToolId !== OPEN_CODE_V2_SYSTEM_TOOL_ID
      && dialect === 'v1'
      && resolved.executable
      && params.exec.run) {
      try {
        const version = await params.exec.run({
          executable: resolved.executable,
          args: ['--version'],
          cwd: { root: 'workspace', relativePath: '' },
        }, params.signal ? { signal: params.signal } : undefined);
        const versionText = new TextDecoder().decode(version.stdout).trim();
        if (version.termination.observed.kind === 'exit'
          && version.termination.observed.exitCode === 0
          && /^v?2\./iu.test(versionText)) {
          dialect = 'v2';
        } else if (version.termination.observed.kind !== 'exit'
          || version.termination.observed.exitCode !== 0
          || !/^v?1\./iu.test(versionText)) {
          params.logger?.warn('[OpenCodeServer] version probe was inconclusive; keeping the legacy readiness route', {
            executablePath: resolved.executablePath,
          });
        }
      } catch (error) {
        // An unknown executable keeps the established V1 route; the managed
        // service reports its own startup failure if the command is unusable.
        params.logger?.warn('[OpenCodeServer] version probe failed; keeping the legacy readiness route', {
          executablePath: resolved.executablePath,
          error,
        });
      }
    }
    const healthPath = openCodeServerHealthPath(dialect, resolved.executablePath);
    params.logger?.info('[OpenCodeServer] resolved managed server readiness route', {
      dialect,
      healthPath,
      executablePath: resolved.executablePath,
    });
    return { dialect, healthPath };
  } catch (error) {
    params.logger?.warn(
      '[OpenCodeServer] could not resolve the OpenCode executable; keeping the legacy readiness route',
      { dialect: 'v1', healthPath: openCodeServerHealthPath('v1'), error },
    );
    return { dialect: 'v1', healthPath: openCodeServerHealthPath('v1') };
  }
}
