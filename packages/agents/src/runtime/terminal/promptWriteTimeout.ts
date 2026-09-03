export const TERMINAL_PROMPT_BASE_WRITE_TIMEOUT_MS = 15_000;
export const TERMINAL_PROMPT_MAX_WRITE_TIMEOUT_MS = 300_000;

const WRITE_TIMEOUT_BYTES_PER_SECOND = 1_024;
const WRITE_TIMEOUT_NEWLINE_OVERHEAD_MS = 50;

// This package's barrel is imported by the Happier web app, so the write budget
// is measured with the universal UTF-8 encoder rather than Node's `Buffer`:
// a `node:buffer` specifier is unresolvable in the browser web bundle. Both
// produce the same UTF-8 byte count, including U+FFFD for a lone surrogate.
const utf8Encoder = new TextEncoder();

export type TerminalPromptWriteBudget = Readonly<{
    timeoutMs: number;
    byteLength: number;
    newlineCount: number;
    byteBudgetMs: number;
    newlineBudgetMs: number;
}>;

export function resolveTerminalPromptWriteBudget(
    text: string,
    options?: Readonly<{
        baseTimeoutMs?: number | undefined;
        maxTimeoutMs?: number | undefined;
    }>,
): TerminalPromptWriteBudget {
    const baseTimeoutMs = Math.max(1, Math.trunc(options?.baseTimeoutMs ?? TERMINAL_PROMPT_BASE_WRITE_TIMEOUT_MS));
    const maxTimeoutMs = Math.max(baseTimeoutMs, Math.trunc(options?.maxTimeoutMs ?? TERMINAL_PROMPT_MAX_WRITE_TIMEOUT_MS));
    const byteLength = utf8Encoder.encode(text).length;
    const newlineCount = text.length === 0 ? 0 : text.split('\n').length - 1;
    const byteBudgetMs = Math.ceil(byteLength / WRITE_TIMEOUT_BYTES_PER_SECOND) * 1_000;
    const newlineBudgetMs = newlineCount * WRITE_TIMEOUT_NEWLINE_OVERHEAD_MS;
    const resolved = Math.max(baseTimeoutMs, byteBudgetMs + newlineBudgetMs);
    return {
        timeoutMs: Math.min(maxTimeoutMs, resolved),
        byteLength,
        newlineCount,
        byteBudgetMs,
        newlineBudgetMs,
    };
}

export function resolveTerminalPromptWriteTimeoutMs(
    text: string,
    options?: Readonly<{
        baseTimeoutMs?: number | undefined;
        maxTimeoutMs?: number | undefined;
    }>,
): number {
    return resolveTerminalPromptWriteBudget(text, options).timeoutMs;
}
