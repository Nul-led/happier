import {
  openCodeServerHealthPath,
  readOpenCodeManagedServerDialect,
  type OpenCodeServerDialect,
} from './dialect.js';
import { OPEN_CODE_SYSTEM_TOOL_ID } from '../../systemTool.js';

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
  }>): Promise<Readonly<{ executablePath: string }>>;
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
 * Which OpenCode generation an *owned* server will be, read from the executable
 * the host resolves for it.
 *
 * This is the single owner of that question for every surface that spawns
 * `opencode serve`: the Session runtime and the External Sessions browse
 * surface. Both the readiness route the managed-service specification declares
 * and the request routes used against the running server derive from this one
 * resolution, so a browse-owned `opencode2` child cannot end up with V2
 * readiness and V1 requests (or, as before, V1 readiness and no reachable
 * server at all).
 *
 * A resolution failure is not fatal here — the supervise call is about to fail
 * on the same missing executable, with the resolver's own message — so this
 * keeps the proven legacy route and says so when a logger is available.
 */
export async function resolveOpenCodeManagedServerDialect(params: Readonly<{
  exec: Readonly<{ systemTools: OpenCodeSystemToolResolver }>;
  cwd?: string;
  signal?: AbortSignal;
  logger?: OpenCodeManagedServerDialectLogger;
}>): Promise<OpenCodeServerDialect> {
  try {
    const resolved = await params.exec.systemTools.resolve({
      toolId: OPEN_CODE_SYSTEM_TOOL_ID,
      purpose: 'Choose the OpenCode managed server readiness route',
      ...(params.cwd ? { cwd: params.cwd } : {}),
      ...(params.signal ? { signal: params.signal } : {}),
    });
    const dialect = readOpenCodeManagedServerDialect(resolved.executablePath);
    params.logger?.info('[OpenCodeServer] resolved managed server readiness route', {
      dialect,
      healthPath: openCodeServerHealthPath(dialect),
      executablePath: resolved.executablePath,
    });
    return dialect;
  } catch (error) {
    params.logger?.warn(
      '[OpenCodeServer] could not resolve the OpenCode executable; keeping the legacy readiness route',
      { dialect: 'v1', healthPath: openCodeServerHealthPath('v1'), error },
    );
    return 'v1';
  }
}
