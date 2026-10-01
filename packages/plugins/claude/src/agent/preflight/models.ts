import type { ExecService, ResolvedSystemTool } from '@happier-dev/plugin-sdk/exec';
const CLAUDE_CLI_HELP_COMMAND_ARGS = ['--help'] as const;
const MIN_PREFLIGHT_MODELS_TIMEOUT_MS = 250;
const PREFLIGHT_OUTPUT_MAX_BYTES = 256 * 1024;
/** The answer is a property of the installed binary, so it only changes when that binary changes. */
const CLAUDE_INSTALLED_SUPPORT_TTL_MS = 5 * 60_000;
/** A failed probe answers `false` fail-closed, so it is re-checked far sooner than a real answer. */
const CLAUDE_INSTALLED_SUPPORT_FAILURE_TTL_MS = 30_000;

type ClaudeInstalledSupport = Readonly<{
    supportsEffort: boolean;
    supportsSystemPromptSnapshotOff: boolean;
    supportsStartupInstructions: boolean;
}>;
type ClaudeInstalledSupportCacheEntry = Readonly<{ expiresAtMs: number; support: ClaudeInstalledSupport }>;

const claudeInstalledSupportByExecutablePath = new Map<string, ClaudeInstalledSupportCacheEntry>();
const claudeInstalledSupportProbesInFlight = new Map<string, Promise<ClaudeInstalledSupport>>();

function readClaudeInstalledSupport(helpText: string): ClaudeInstalledSupport {
    return {
        supportsEffort: /\B--effort\b/i.test(helpText),
        supportsSystemPromptSnapshotOff: /\B--system-prompt-snapshot\s+<on\|off>/i.test(helpText),
        supportsStartupInstructions: /\B--system-prompt-snapshot\s+<on\|off>/i.test(helpText)
            && /\B--append-system-prompt-file\b/i.test(helpText),
    };
}

function buildClaudePreflightEnv(
    env: Readonly<Record<string, string | undefined>> | undefined,
): Readonly<Record<string, string>> {
    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(env ?? {})) {
        if (typeof value === 'string') output[key] = value;
    }
    output.CI = '1';
    return output;
}

async function runClaudeHelpProbe(params: Readonly<{
    exec: ExecService;
    executable: ResolvedSystemTool['executable'];
    timeoutMs: number;
    env?: Readonly<Record<string, string | undefined>>;
}>): Promise<Readonly<{ support: ClaudeInstalledSupport; probeFailed: boolean }>> {
    try {
        const result = await params.exec.run({
            executable: params.executable,
            args: CLAUDE_CLI_HELP_COMMAND_ARGS,
            cwd: { root: 'workspace', relativePath: '' },
            env: buildClaudePreflightEnv(params.env),
            maxStderrBytes: PREFLIGHT_OUTPUT_MAX_BYTES,
            maxStdoutBytes: PREFLIGHT_OUTPUT_MAX_BYTES,
            timeoutMs: Math.max(MIN_PREFLIGHT_MODELS_TIMEOUT_MS, params.timeoutMs),
        });
        if (result.termination.observed.kind !== 'exit' || result.termination.observed.exitCode !== 0) {
            return { support: readClaudeInstalledSupport(''), probeFailed: true };
        }
        const decoder = new TextDecoder();
        const stdout = decoder.decode(result.stdout);
        const helpText = stdout.trim() ? stdout : decoder.decode(result.stderr);
        return { support: readClaudeInstalledSupport(helpText), probeFailed: false };
    } catch {
        return { support: readClaudeInstalledSupport(''), probeFailed: true };
    }
}

/**
 * Resolve launch-control support from the installed Claude CLI's own help output.
 *
 * Every Claude session and execution-run open needs this fact before it can launch, so the
 * `--help` spawn is both TTL-cached and de-duplicated while in flight, keyed on the resolved
 * binary path (the only input that can change the answer; `cwd` reaches it through resolution).
 * The in-flight half is load-bearing: a fan-out that opens N Claude runs at once would otherwise
 * have every caller pay the whole spawn before the first one could populate the cache.
 */
async function probeClaudeInstalledSupportRaw(params: Readonly<{
    exec: ExecService;
    cwd: string;
    timeoutMs: number;
    env?: Readonly<Record<string, string | undefined>>;
    now?: () => number;
}>): Promise<ClaudeInstalledSupport> {
    let resolved: ResolvedSystemTool;
    try {
        resolved = await params.exec.systemTools.resolve({
            toolId: 'claude-cli',
            purpose: 'Probe Claude launch-control support',
            cwd: params.cwd,
        });
    } catch {
        return readClaudeInstalledSupport('');
    }

    const executablePath = resolved.executablePath;
    const readNowMs = () => params.now?.() ?? Date.now();
    const cached = claudeInstalledSupportByExecutablePath.get(executablePath);
    if (cached && cached.expiresAtMs > readNowMs()) return cached.support;

    const inFlight = claudeInstalledSupportProbesInFlight.get(executablePath);
    if (inFlight) return await inFlight;

    const pending = (async () => {
        try {
            const outcome = await runClaudeHelpProbe({
                exec: params.exec,
                executable: resolved.executable,
                timeoutMs: params.timeoutMs,
                ...(params.env ? { env: params.env } : {}),
            });
            claudeInstalledSupportByExecutablePath.set(executablePath, {
                support: outcome.support,
                expiresAtMs: readNowMs() + (outcome.probeFailed
                    ? CLAUDE_INSTALLED_SUPPORT_FAILURE_TTL_MS
                    : CLAUDE_INSTALLED_SUPPORT_TTL_MS),
            });
            return outcome.support;
        } finally {
            claudeInstalledSupportProbesInFlight.delete(executablePath);
        }
    })();
    claudeInstalledSupportProbesInFlight.set(executablePath, pending);
    return await pending;
}

export async function probeClaudeSupportsEffortRaw(
    params: Parameters<typeof probeClaudeInstalledSupportRaw>[0],
): Promise<boolean> {
    return (await probeClaudeInstalledSupportRaw(params)).supportsEffort;
}

export async function probeClaudeSupportsSystemPromptSnapshotOffRaw(
    params: Parameters<typeof probeClaudeInstalledSupportRaw>[0],
): Promise<boolean> {
    return (await probeClaudeInstalledSupportRaw(params)).supportsSystemPromptSnapshotOff;
}

export async function probeClaudeSupportsStartupInstructionsRaw(
    params: Parameters<typeof probeClaudeInstalledSupportRaw>[0],
): Promise<boolean> {
    return (await probeClaudeInstalledSupportRaw(params)).supportsStartupInstructions;
}
