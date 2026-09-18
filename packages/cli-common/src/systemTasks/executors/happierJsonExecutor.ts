import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import {
  installVersionedPayload,
  prepareFirstPartyComponentPayloadFromGitHubRelease,
  readInstalledVersionMarkersSync,
  resolveFirstPartyInstallLayout,
  resolveInstalledFirstPartyComponentPaths,
  type FirstPartyComponentId,
  type PreparedFirstPartyComponentPayload,
} from '../../firstPartyRuntime/index.js';
import { resolveWindowsCommandInvocation } from '../../process/index.js';
import { SystemTaskExecutionError } from '../runSystemTask.js';
import { applyPublicReleaseRingScopeToEnv } from './releaseRingScopedEnv.js';

export const DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES = [
  'HAPPIER_BOOTSTRAP_CLI_PATH',
  'HAPPIER_BOOTSTRAP_HAPPIER_PATH',
] as const;

export type HappierTextResult = Readonly<{
  status: number;
  stdout: string;
  stderr: string;
}>;

export type RunHappierOptions = Readonly<{
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  signal?: AbortSignal;
  /** `null` explicitly disables the process timeout after irreversible-operation admission. */
  timeoutMs?: number | null;
  onStdoutChunk?: (text: string) => void;
  includeStdoutInError?: boolean;
  /** Ephemeral process input. Callers must keep credentials and durable secrets out. */
  input?: string;
}>;

export interface HappierJsonExecutor {
  runHappierText(args: readonly string[], opts?: RunHappierOptions): Promise<HappierTextResult>;
  runHappierJson(
    args: readonly string[],
    opts?: RunHappierOptions & Readonly<{ allowJsonFailure?: boolean }>,
  ): Promise<unknown>;
}

type CommandExecutionResult = Readonly<{
  status: number;
  stdout: string;
  stderr: string;
}>;

const MAX_HAPPIER_PROCESS_INPUT_BYTES = 64 * 1024;

async function runCommandCapture(params: Readonly<{
  command: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number | null;
  input?: string;
  onStdoutChunk?: (text: string) => void;
}>): Promise<CommandExecutionResult> {
  if (params.input !== undefined && Buffer.byteLength(params.input, 'utf8') > MAX_HAPPIER_PROCESS_INPUT_BYTES) {
    throw new SystemTaskExecutionError('input_limit_exceeded', 'Happier CLI input exceeds the supported size.');
  }
  const invocation = resolveWindowsCommandInvocation({
    command: params.command,
    args: [...params.args],
    env: params.env,
  });

  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const child = spawn(invocation.command, invocation.args, {
      env: params.env,
      cwd: params.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const cleanupAbortListener = () => {
      if (!params.signal) return;
      params.signal.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      cleanupAbortListener();
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      rejectPromise(new Error('Command aborted.'));
    };

    if (params.signal) {
      if (params.signal.aborted) {
        onAbort();
        return;
      }
      params.signal.addEventListener('abort', onAbort, { once: true });
    }

    if (params.timeoutMs !== null) {
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanupAbortListener();
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        rejectPromise(new Error(`Command timed out: ${params.command}`));
      }, Number.isFinite(params.timeoutMs) ? Math.max(1, Math.floor(params.timeoutMs as number)) : 60_000);
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      params.onStdoutChunk?.(chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.stdin?.on('error', () => {
      // The child exit/error event is the command authority. An early exit can
      // close stdin while bounded input is still being written; do not turn
      // that expected EPIPE into an unhandled process error.
    });

    if (params.input !== undefined) {
      child.stdin?.end(params.input);
    } else {
      child.stdin?.end();
    }

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      cleanupAbortListener();
      rejectPromise(error);
    });

    child.once('exit', (code) => {
      if (settled) return;
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      cleanupAbortListener();
      resolvePromise({
        status: typeof code === 'number' ? code : 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

function parseFirstJsonObject(text: string): unknown {
  const lines = String(text ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  return null;
}

function isJsonFailureEnvelope(value: unknown): value is Readonly<{ ok: false }> {
  return Boolean(
    value
      && typeof value === 'object'
      && 'ok' in value
      && (value as { ok?: unknown }).ok === false,
  );
}

function resolveRepoRootForFirstPartyComponent(processEnv: NodeJS.ProcessEnv): string | null {
  const explicitRepoRoot = String(
    processEnv.HAPPIER_STACK_REPO_DIR ??
      processEnv.HAPPIER_STACK_CLI_ROOT_DIR ??
      '',
  ).trim();
  const startDir = explicitRepoRoot || process.cwd();
  if (!startDir) return null;

  let cursor = resolve(startDir);
  while (true) {
    const stackBin = join(cursor, 'apps', 'stack', 'bin', 'hstack.mjs');
    const cliBin = join(cursor, 'apps', 'cli', 'bin', 'happier.mjs');
    if (existsSync(stackBin) || existsSync(cliBin)) {
      return cursor;
    }

    const parent = dirname(cursor);
    if (!parent || parent === cursor) break;
    cursor = parent;
  }

  return null;
}

function resolveRepoLocalFirstPartyCommandPath(params: Readonly<{
  componentId: FirstPartyComponentId;
  processEnv: NodeJS.ProcessEnv;
}>): string | null {
  const repoRoot = resolveRepoRootForFirstPartyComponent(params.processEnv);
  if (!repoRoot) {
    return null;
  }

  const candidates =
    params.componentId === 'hstack'
      ? [
          join(repoRoot, 'apps', 'stack', 'bin', 'hstack.mjs'),
          join(repoRoot, 'packages', 'stack', 'bin', 'hstack.mjs'),
        ]
      : params.componentId === 'happier-cli'
        ? [
            join(repoRoot, 'apps', 'cli', 'bin', 'happier.mjs'),
            join(repoRoot, 'packages', 'cli', 'bin', 'happier.mjs'),
          ]
        : [];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Where a local first-party command came from.
 *
 * `managed` means this machine's install path actually produced it: the verified release payload
 * (`prepareFirstPartyComponentPayloadFromGitHubRelease` -> `installVersionedPayload`) was promoted
 * under the install root, which records `current.version` next to the payload it installed at
 * `versions/<versionId>/`. Both the record and the binary it names must be present, because that
 * install is the only thing release verification ever happened for. Everything else is `override`
 * - an explicit env override, a repo-local checkout, or a binary that merely exists at
 * `<installRoot>/current` with no install behind it: usable, never trusted for automatic pairing
 * approval. Later same-user tampering with a recorded managed install is outside this boundary; a
 * directory nothing ever installed into is not - no verification was performed there at all.
 */
export type LocalFirstPartyCommandProvenance = 'managed' | 'override';

export type ResolvedLocalFirstPartyCommand = Readonly<{
  command: string;
  provenance: LocalFirstPartyCommandProvenance;
}>;

export function resolveExplicitOrInstalledLocalFirstPartyCommand(params: Readonly<{
  componentId: FirstPartyComponentId;
  processEnv: NodeJS.ProcessEnv;
  envVarNames?: readonly string[];
  releaseRing?: PublicReleaseRingId;
}>): ResolvedLocalFirstPartyCommand | null {
  for (const envVarName of params.envVarNames ?? []) {
    const explicit = String(params.processEnv[envVarName] ?? '').trim();
    if (explicit) {
      return { command: explicit, provenance: 'override' };
    }
  }

  const repoLocalPath = resolveRepoLocalFirstPartyCommandPath({
    componentId: params.componentId,
    processEnv: params.processEnv,
  });
  if (repoLocalPath) {
    return { command: repoLocalPath, provenance: 'override' };
  }

  try {
    return resolveInstalledLocalFirstPartyCommand(params);
  } catch {
    // ignore and continue to managed install acquisition
  }

  return null;
}

/**
 * The installed command under the install root, classified by whether an install actually recorded
 * it. `promoteVersionedPayload` writes the payload to `versions/<versionId>` and only then writes
 * the `current.version` marker, so a marker naming a version whose binary is present is the install
 * path's own record of what it put there. A binary sitting at `<installRoot>/current` without that
 * record was never acquired or verified here, so it resolves as `override`: still runnable, never
 * automatically approved for pairing.
 */
function resolveInstalledLocalFirstPartyCommand(params: Readonly<{
  componentId: FirstPartyComponentId;
  processEnv: NodeJS.ProcessEnv;
  releaseRing?: PublicReleaseRingId;
}>): ResolvedLocalFirstPartyCommand | null {
  const paths = resolveInstalledFirstPartyComponentPaths({
    componentId: params.componentId,
    processEnv: params.processEnv,
    releaseRing: params.releaseRing,
  });
  const layout = resolveFirstPartyInstallLayout({
    componentId: params.componentId,
    processEnv: params.processEnv,
    releaseRing: params.releaseRing,
  });
  const { currentVersionId } = readInstalledVersionMarkersSync(layout);
  if (currentVersionId && paths.resolvedBinaryPath && existsSync(paths.resolvedBinaryPath)) {
    return { command: paths.binaryPath, provenance: 'managed' };
  }
  if (existsSync(paths.binaryPath)) {
    return { command: paths.binaryPath, provenance: 'override' };
  }
  return null;
}

type PreparedPayload = Pick<PreparedFirstPartyComponentPayload, 'versionId' | 'payloadRoot' | 'cleanup'>;

type EnsureLocalFirstPartyCommandDeps = Readonly<{
  preparePayload: (params: Readonly<{ componentId: FirstPartyComponentId; channel: PublicReleaseRingId }>) => Promise<PreparedPayload>;
  installPayload: typeof installVersionedPayload;
}>;

export async function ensureLocalFirstPartyComponentCommand(params: Readonly<{
  componentId: FirstPartyComponentId;
  processEnv: NodeJS.ProcessEnv;
  envVarNames?: readonly string[];
  releaseRing?: PublicReleaseRingId;
}>, overrides: Partial<EnsureLocalFirstPartyCommandDeps> = {}): Promise<string> {
  const releaseRing = params.releaseRing ?? 'stable';
  const resolved = resolveExplicitOrInstalledLocalFirstPartyCommand(params);
  if (resolved) {
    return resolved.command;
  }

  const deps: EnsureLocalFirstPartyCommandDeps = {
    preparePayload: async (innerParams) => await prepareFirstPartyComponentPayloadFromGitHubRelease(innerParams),
    installPayload: installVersionedPayload,
    ...overrides,
  };

  let prepared: PreparedPayload | null = null;
  try {
    prepared = await deps.preparePayload({
      componentId: params.componentId,
      channel: releaseRing,
    });

    await deps.installPayload({
      componentId: params.componentId,
      processEnv: params.processEnv,
      releaseRing,
      versionId: prepared.versionId,
      payloadRoot: prepared.payloadRoot,
    });
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : `Failed to acquire ${params.componentId}.`;
    throw new SystemTaskExecutionError('first_party_component_install_failed', message);
  } finally {
    if (prepared) {
      await prepared.cleanup().catch(() => undefined);
    }
  }

  const installed = resolveExplicitOrInstalledLocalFirstPartyCommand({
    componentId: params.componentId,
    processEnv: params.processEnv,
    envVarNames: params.envVarNames,
    releaseRing,
  });
  if (installed) {
    return installed.command;
  }

  throw new SystemTaskExecutionError(
    'first_party_component_install_failed',
    `Installed ${params.componentId} but could not resolve it.`,
  );
}

export function createLocalHappierJsonExecutor(params: Readonly<{
  processEnv?: NodeJS.ProcessEnv;
  envVarNames?: readonly string[];
  releaseRing?: PublicReleaseRingId;
}> = {}): HappierJsonExecutor {
  const defaultProcessEnv = params.processEnv ?? process.env;
  const envVarNames = params.envVarNames ?? DEFAULT_HAPPIER_CLI_ENV_VAR_NAMES;
  const releaseRing = params.releaseRing;

  let installPromise: Promise<void> | null = null;
  const ensureCommand = async (processEnv: NodeJS.ProcessEnv): Promise<string> => {
    const resolved = resolveExplicitOrInstalledLocalFirstPartyCommand({
      componentId: 'happier-cli',
      processEnv,
      envVarNames,
      releaseRing,
    });
    if (resolved) {
      return resolved.command;
    }

    if (!installPromise) {
      installPromise = ensureLocalFirstPartyComponentCommand({
        componentId: 'happier-cli',
        processEnv,
        envVarNames,
        releaseRing,
      }).then(() => undefined);
    }
    await installPromise;

    const installed = resolveExplicitOrInstalledLocalFirstPartyCommand({
      componentId: 'happier-cli',
      processEnv,
      envVarNames,
      releaseRing,
    });
    if (installed) {
      return installed.command;
    }

    throw new SystemTaskExecutionError(
      'first_party_component_install_failed',
      'Installed happier-cli but could not resolve it.',
    );
  };

  return {
    async runHappierText(args, opts) {
      const processEnv = opts?.env ?? defaultProcessEnv;
      const command = await ensureCommand(processEnv);
      const scopedEnv = applyPublicReleaseRingScopeToEnv(processEnv, releaseRing ?? null);
      const result = await runCommandCapture({
        command,
        args,
        env: scopedEnv,
        cwd: opts?.cwd,
        signal: opts?.signal,
        timeoutMs: opts?.timeoutMs,
        input: opts?.input,
        onStdoutChunk: opts?.onStdoutChunk,
      }).catch((error: unknown) => {
        const message = error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Failed to spawn Happier CLI.';
        throw new SystemTaskExecutionError('cli_spawn_failed', message);
      });

      return result;
    },

    async runHappierJson(args, opts) {
      const allowJsonFailure = opts?.allowJsonFailure;
      const result = await this.runHappierText(args, opts);
      const parsed = parseFirstJsonObject(result.stdout);

      if (result.status !== 0) {
        if (allowJsonFailure && parsed && typeof parsed === 'object') {
          return parsed;
        }
        throw new SystemTaskExecutionError(
          'cli_command_failed',
          result.stderr.trim() || result.stdout.trim() || 'Command failed.',
        );
      }

      if (!parsed || typeof parsed !== 'object') {
        throw new SystemTaskExecutionError(
          'invalid_cli_response',
          `Command did not return a JSON object: ${args.join(' ')}`,
        );
      }

      if (!allowJsonFailure && isJsonFailureEnvelope(parsed)) {
        const envelope = parsed as {
          error?: { code?: unknown; message?: unknown } | unknown;
          message?: unknown;
        };
        const message = typeof envelope.message === 'string' && envelope.message.trim()
          ? envelope.message.trim()
          : envelope.error && typeof envelope.error === 'object' && envelope.error !== null
              && typeof (envelope.error as { message?: unknown }).message === 'string'
            ? ((envelope.error as { message?: string }).message ?? '').trim()
            : `Command failed: ${args.join(' ')}`;
        throw new SystemTaskExecutionError('cli_command_failed', message);
      }

      return parsed;
    },
  };
}
