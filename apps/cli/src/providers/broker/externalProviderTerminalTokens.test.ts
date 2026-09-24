import { describe, expect, it } from 'vitest';
import { PROVIDER_ENDPOINT_SAFETY_LIMITS } from '@happier-dev/protocol';
import type { TeamCredentialRequestProtocolKindV1 } from '@happier-dev/protocol/teams';

import { createExternalProviderTerminalTokenReader } from './externalProviderTerminalTokens';

const encoder = new TextEncoder();

function observe(input: Readonly<{
    routeKind: TeamCredentialRequestProtocolKindV1;
    contentType: string | null;
    body: string;
    chunkSize?: number;
}>) {
    const reader = createExternalProviderTerminalTokenReader({
        routeKind: input.routeKind,
        contentType: input.contentType,
    });
    const bytes = encoder.encode(input.body);
    const size = input.chunkSize ?? 7;
    for (let offset = 0; offset < bytes.byteLength; offset += size) {
        reader.push(bytes.slice(offset, offset + size));
    }
    return reader.read();
}

describe('external Provider terminal token observation', () => {
    it('converts the non-streamed terminal usage block of every managed generation route', () => {
        expect(observe({
            routeKind: 'anthropic_messages',
            contentType: 'application/json',
            body: JSON.stringify({
                id: 'msg_1',
                model: 'claude-sonnet-4-5-20250929',
                usage: {
                    input_tokens: 100,
                    output_tokens: 25,
                    cache_read_input_tokens: 40,
                    cache_creation_input_tokens: 10,
                },
            }),
        })).toEqual({
            actualModelId: 'claude-sonnet-4-5-20250929',
            // Anthropic never folds cache into `input_tokens`, so the Happier
            // total is the sum — the Claude Agent observation's convention.
            tokens: { input: 100, output: 25, reasoning: 0, cacheRead: 40, cacheWrite: 10, total: 175 },
        });
        expect(observe({
            routeKind: 'openai_responses',
            contentType: 'application/json',
            body: JSON.stringify({
                id: 'resp_1',
                model: 'gpt-5-2025-11-01',
                usage: {
                    input_tokens: 120,
                    input_tokens_details: { cached_tokens: 80 },
                    output_tokens: 45,
                    output_tokens_details: { reasoning_tokens: 30 },
                    total_tokens: 165,
                },
            }),
        })).toEqual({
            actualModelId: 'gpt-5-2025-11-01',
            // OpenAI already counts cached input inside `input_tokens` and
            // reasoning inside `output_tokens`, so its reported total stands.
            tokens: { input: 120, output: 45, reasoning: 30, cacheRead: 80, cacheWrite: 0, total: 165 },
        });
        expect(observe({
            routeKind: 'openai_chat_completions',
            contentType: 'application/json',
            body: JSON.stringify({
                id: 'chatcmpl_1',
                model: 'gpt-5-mini',
                usage: {
                    prompt_tokens: 60,
                    prompt_tokens_details: { cached_tokens: 20 },
                    completion_tokens: 15,
                    completion_tokens_details: { reasoning_tokens: 5 },
                    total_tokens: 75,
                },
            }),
        })).toEqual({
            actualModelId: 'gpt-5-mini',
            tokens: { input: 60, output: 15, reasoning: 5, cacheRead: 20, cacheWrite: 0, total: 75 },
        });
    });

    it('merges the two halves of an Anthropic stream into one terminal fact', () => {
        expect(observe({
            routeKind: 'anthropic_messages',
            contentType: 'text/event-stream; charset=utf-8',
            body: [
                'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude-opus-4-6",'
                    + '"usage":{"input_tokens":200,"cache_read_input_tokens":50,"cache_creation_input_tokens":0,"output_tokens":1}}}\n\n',
                'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
                'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":90}}\n\n',
                'event: message_stop\ndata: {"type":"message_stop"}\n\n',
            ].join(''),
        })).toEqual({
            actualModelId: 'claude-opus-4-6',
            tokens: { input: 200, output: 90, reasoning: 0, cacheRead: 50, cacheWrite: 0, total: 340 },
        });
    });

    it('takes the completed Responses event rather than an earlier one', () => {
        expect(observe({
            routeKind: 'openai_responses',
            contentType: 'text/event-stream',
            body: [
                'event: response.created\ndata: {"type":"response.created","response":{"model":"gpt-5","usage":null}}\n\n',
                'event: response.completed\ndata: {"type":"response.completed","response":{"model":"gpt-5",'
                    + '"usage":{"input_tokens":10,"output_tokens":4,"total_tokens":14}}}\n\n',
            ].join(''),
        })).toEqual({
            actualModelId: 'gpt-5',
            tokens: { input: 10, output: 4, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 14 },
        });
    });

    it('leaves a streamed chat completion without caller-requested usage unknown', () => {
        // The OpenAI Chat Completions contract emits `usage` in a stream only
        // when the caller sends `stream_options.include_usage`, and the broker
        // does not rewrite the caller's request to add it. This is exactly why
        // the external terminal route cannot guarantee token coverage.
        expect(observe({
            routeKind: 'openai_chat_completions',
            contentType: 'text/event-stream',
            body: [
                'data: {"id":"chatcmpl_1","model":"gpt-5-mini","choices":[{"delta":{"content":"hi"}}],"usage":null}\n\n',
                'data: {"id":"chatcmpl_1","model":"gpt-5-mini","choices":[{"delta":{},"finish_reason":"stop"}],"usage":null}\n\n',
                'data: [DONE]\n\n',
            ].join(''),
        })).toEqual({ actualModelId: 'gpt-5-mini', tokens: null });
        // The same route with the caller's flag does report, so the reader is
        // not silently blind to the streamed chat shape.
        expect(observe({
            routeKind: 'openai_chat_completions',
            contentType: 'text/event-stream',
            body: 'data: {"model":"gpt-5-mini","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}}\n\n'
                + 'data: [DONE]\n\n',
        })).toEqual({
            actualModelId: 'gpt-5-mini',
            tokens: { input: 8, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 10 },
        });
    });

    it('never invents, completes or estimates a number the Provider did not report', () => {
        for (const body of [
            '{"model":"gpt-5"}',
            '{"model":"gpt-5","usage":{}}',
            '{"model":"gpt-5","usage":{"input_tokens":-3}}',
            '{"model":"gpt-5","usage":{"input_tokens":1.5}}',
            'not json at all',
            '',
        ]) {
            expect(observe({ routeKind: 'openai_responses', contentType: 'application/json', body }).tokens)
                .toBeNull();
        }
        // A Provider body beyond the canonical request budget is relayed but
        // not retained, so its observation stays unknown instead of growing the
        // daemon's memory or reporting a partial parse.
        const oversized = `{"model":"gpt-5","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2},"pad":"${
            'x'.repeat(PROVIDER_ENDPOINT_SAFETY_LIMITS.maxDecodedBodyBytes)}"}`;
        expect(observe({
            routeKind: 'openai_responses',
            contentType: 'application/json',
            body: oversized,
            chunkSize: 64 * 1024,
        })).toEqual({ actualModelId: null, tokens: null });
    });

    it('keeps observing a long stream whose total size exceeds the budget', () => {
        // A stream is observed one event at a time, so only an unterminated
        // event is held. A long answer made of small deltas must still report
        // the terminal usage that arrives after the budget's worth of bytes.
        const delta = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"'
            + 'x'.repeat(1_000) + '"}}\n\n';
        const deltas = delta.repeat(Math.ceil(PROVIDER_ENDPOINT_SAFETY_LIMITS.maxDecodedBodyBytes / delta.length) + 1);
        expect(observe({
            routeKind: 'anthropic_messages',
            contentType: 'text/event-stream',
            chunkSize: 64 * 1024,
            body: 'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-4-6",'
                + '"usage":{"input_tokens":12,"output_tokens":1}}}\n\n'
                + deltas
                + 'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4000}}\n\n',
        })).toEqual({
            actualModelId: 'claude-opus-4-6',
            tokens: { input: 12, output: 4000, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 4012 },
        });
    });
});
