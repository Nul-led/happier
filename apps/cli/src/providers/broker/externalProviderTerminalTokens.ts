import { PROVIDER_ENDPOINT_SAFETY_LIMITS, type UsageObservationTokens } from '@happier-dev/protocol';
import type { TeamCredentialRequestProtocolKindV1 } from '@happier-dev/protocol/teams';

/**
 * The public external Provider route has no Session turn and no Agent usage
 * publisher, so the only terminal token fact that exists for one of its
 * requests is the one the Provider itself puts in the admitted response. This
 * reader observes that response exactly once, on the single pass the terminal
 * outcome observer already makes, and converts the Provider's own usage block
 * for the routes whose protocol guarantees one.
 *
 * It never derives, estimates or completes a number the Provider did not
 * report: an absent or unparseable usage block leaves the observation unknown,
 * which the terminal report carries as `measurement: 'unavailable'`.
 */
export type ExternalProviderTerminalTokenObservation = Readonly<{
    actualModelId: string | null;
    tokens: UsageObservationTokens | null;
}>;

export type ExternalProviderTerminalTokenReader = Readonly<{
    push(chunk: Uint8Array): void;
    read(): ExternalProviderTerminalTokenObservation;
}>;

type JsonObject = Record<string, unknown>;

// Route conformance: Responses and Messages carry terminal usage on every
// admitted request. A streamed Chat Completion carries it only when the caller
// sent `stream_options.include_usage`, which the broker never adds, so that
// request stays `unavailable` and the server keeps the resource-wide external
// token capability closed (`usageCapabilities.ts`, the single decision owner).

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readModelId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.length <= PROVIDER_ENDPOINT_SAFETY_LIMITS.maxHeaderValueChars
        ? trimmed
        : null;
}

function nestedCount(container: unknown, key: string): number | null {
    return isObject(container) ? readCount(container[key]) : null;
}

/**
 * Anthropic Messages reports each half of the request separately and never
 * folds cache reads or writes into `input_tokens`, so the Happier total is
 * their sum — the same convention the Claude Agent observation already uses.
 */
function anthropicTokens(usage: JsonObject): UsageObservationTokens | null {
    const input = readCount(usage.input_tokens);
    const output = readCount(usage.output_tokens);
    const cacheRead = readCount(usage.cache_read_input_tokens);
    const cacheWrite = readCount(usage.cache_creation_input_tokens);
    if (input === null && output === null && cacheRead === null && cacheWrite === null) return null;
    return Object.freeze({
        input: input ?? 0,
        output: output ?? 0,
        reasoning: 0,
        cacheRead: cacheRead ?? 0,
        cacheWrite: cacheWrite ?? 0,
        total: (input ?? 0) + (output ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0),
    });
}

/**
 * Both OpenAI protocols count cached input inside the prompt/input total and
 * reasoning inside the completion/output total, and both publish the authored
 * `total_tokens`; that reported total is preserved rather than recomputed.
 */
function openAiTokens(
    usage: JsonObject,
    fields: Readonly<{
        input: string;
        output: string;
        inputDetails: string;
        outputDetails: string;
        cached: string;
    }>,
): UsageObservationTokens | null {
    const input = readCount(usage[fields.input]);
    const output = readCount(usage[fields.output]);
    if (input === null && output === null) return null;
    const cacheRead = nestedCount(usage[fields.inputDetails], fields.cached);
    const reasoning = nestedCount(usage[fields.outputDetails], 'reasoning_tokens');
    return Object.freeze({
        input: input ?? 0,
        output: output ?? 0,
        reasoning: reasoning ?? 0,
        cacheRead: cacheRead ?? 0,
        cacheWrite: 0,
        total: readCount(usage.total_tokens) ?? (input ?? 0) + (output ?? 0),
    });
}

function routeTokens(
    routeKind: TeamCredentialRequestProtocolKindV1,
    usage: unknown,
): UsageObservationTokens | null {
    if (!isObject(usage)) return null;
    if (routeKind === 'anthropic_messages') return anthropicTokens(usage);
    if (routeKind === 'openai_responses') {
        return openAiTokens(usage, {
            input: 'input_tokens',
            output: 'output_tokens',
            inputDetails: 'input_tokens_details',
            outputDetails: 'output_tokens_details',
            cached: 'cached_tokens',
        });
    }
    return openAiTokens(usage, {
        input: 'prompt_tokens',
        output: 'completion_tokens',
        inputDetails: 'prompt_tokens_details',
        outputDetails: 'completion_tokens_details',
        cached: 'cached_tokens',
    });
}

/** The Provider payload that carries the terminal usage block for this route. */
function terminalCarrier(
    routeKind: TeamCredentialRequestProtocolKindV1,
    payload: JsonObject,
): JsonObject | null {
    if (routeKind !== 'openai_responses') return payload;
    // A Responses event wraps the whole response object; the completed one is
    // the only event that carries the terminal usage.
    const response = payload.response;
    return isObject(response) ? response : payload;
}

function parseJsonObject(text: string): JsonObject | null {
    try {
        const value: unknown = JSON.parse(text);
        return isObject(value) ? value : null;
    } catch {
        return null;
    }
}

export function createExternalProviderTerminalTokenReader(input: Readonly<{
    routeKind: TeamCredentialRequestProtocolKindV1;
    contentType: string | null;
}>): ExternalProviderTerminalTokenReader {
    const streamed = (input.contentType ?? '').toLowerCase().includes('text/event-stream');
    const decoder = new TextDecoder('utf-8');
    // The observer never HOLDS more than the canonical Provider body budget:
    // the whole body when it is one JSON document, one unterminated event when
    // it is a stream (drained events are released). A long stream of small
    // events therefore stays observed; one held value beyond the budget leaves
    // the observation unknown rather than growing the daemon's memory with a
    // response it is merely passing through.
    const budget = PROVIDER_ENDPOINT_SAFETY_LIMITS.maxDecodedBodyBytes;
    let overflowed = false;
    let pending = '';
    let modelId: string | null = null;
    let tokens: UsageObservationTokens | null = null;

    const observeStreamedPayload = (payload: JsonObject): void => {
        const carrier = terminalCarrier(input.routeKind, payload);
        if (!carrier) return;
        modelId = readModelId(carrier.model) ?? modelId;
        if (input.routeKind === 'anthropic_messages' && isObject(carrier.message)) {
            modelId = readModelId(carrier.message.model) ?? modelId;
        }
        const usage = input.routeKind === 'anthropic_messages' && isObject(carrier.message)
            ? carrier.message.usage
            : carrier.usage;
        const observed = routeTokens(input.routeKind, usage);
        if (!observed) return;
        // Anthropic splits one request across `message_start` (prompt and cache)
        // and `message_delta` (completion), so each half is merged into the one
        // terminal fact instead of replacing it.
        tokens = input.routeKind === 'anthropic_messages' && tokens
            ? Object.freeze({
                input: Math.max(tokens.input, observed.input),
                output: Math.max(tokens.output, observed.output),
                reasoning: 0,
                cacheRead: Math.max(tokens.cacheRead, observed.cacheRead),
                cacheWrite: Math.max(tokens.cacheWrite, observed.cacheWrite),
                total: 0,
            })
            : observed;
    };

    const drainStreamedLines = (final: boolean): void => {
        for (;;) {
            const breakIndex = pending.indexOf('\n');
            if (breakIndex < 0) break;
            const line = pending.slice(0, breakIndex).trimEnd();
            pending = pending.slice(breakIndex + 1);
            if (!line.startsWith('data:')) continue;
            const payload = parseJsonObject(line.slice('data:'.length).trim());
            if (payload) observeStreamedPayload(payload);
        }
        if (!final || !pending.startsWith('data:')) return;
        const payload = parseJsonObject(pending.slice('data:'.length).trim());
        if (payload) observeStreamedPayload(payload);
        pending = '';
    };

    return Object.freeze({
        push(chunk: Uint8Array): void {
            if (overflowed) return;
            pending += decoder.decode(chunk, { stream: true });
            if (streamed) drainStreamedLines(false);
            // UTF-16 length bounds the held UTF-8 bytes from below, so this
            // never fires early; it fires once the held text is at least the budget.
            if (pending.length > budget) {
                overflowed = true;
                pending = '';
            }
        },
        read(): ExternalProviderTerminalTokenObservation {
            if (overflowed) return Object.freeze({ actualModelId: null, tokens: null });
            pending += decoder.decode();
            if (streamed) {
                drainStreamedLines(true);
            } else {
                const payload = parseJsonObject(pending);
                if (payload) {
                    const carrier = terminalCarrier(input.routeKind, payload);
                    modelId = readModelId(carrier?.model) ?? modelId;
                    tokens = routeTokens(input.routeKind, carrier?.usage) ?? tokens;
                }
                pending = '';
            }
            const merged = tokens && input.routeKind === 'anthropic_messages'
                ? Object.freeze({
                    ...tokens,
                    total: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
                })
                : tokens;
            return Object.freeze({ actualModelId: modelId, tokens: merged });
        },
    });
}
