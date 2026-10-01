import { describe, expect, it } from 'vitest';
import { resolveTranscriptBodySessionMessageRole } from '@happier-dev/protocol';

import { hasSyntheticNoResponseMeta } from "../messages/syntheticNoResponseMessageMeta.js";
import { normalizeRawMessage } from "./normalize.js";

function createProducerShapedSyntheticNoResponseRaw() {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                uuid: 'synthetic-uuid',
                isSidechain: false,
                model: '<synthetic>',
                message: {
                    role: 'assistant',
                    stop_reason: 'end_turn',
                    content: [{ type: 'text', text: 'No response requested.' }],
                },
            },
        },
        meta: { source: 'cli' },
    } as const;
}

describe('normalizeRawMessage messageRole metadata', () => {
    it('matches the protocol user role for an ACP text body without stored messageRole', () => {
        const body = { type: 'text', role: 'user', text: 'an ACP user text row' };
        const normalized = normalizeRawMessage('stored-acp-text-role', null, 1, {
            role: 'agent', content: { type: 'acp', agentId: 'opencode', data: body },
        });
        expect(normalized?.role).toBe(resolveTranscriptBodySessionMessageRole({ protocol: 'acp', body }));
        expect(normalized?.content).toEqual({ type: 'text', text: body.text });
    });
    it.each(['acp', 'codex'] as const)('matches the protocol role for a stored %s message without messageRole', (protocol) => {
        const body = { type: 'message', role: 'user', message: 'a stored user turn' };
        const normalized = normalizeRawMessage('stored-role', null, 1, {
            role: 'agent', content: { type: protocol, ...(protocol === 'acp' ? { agentId: 'opencode' } : {}), data: body },
        });
        expect(normalized?.role).toBe(resolveTranscriptBodySessionMessageRole({ protocol, body }));
        expect(normalized?.content).toEqual(protocol === 'codex'
            ? { type: 'text', text: body.message }
            : [expect.objectContaining({ type: 'text', text: body.message })]);
    });
    it('marks Claude synthetic no-response rows for reducer suppression even when stored as events', () => {
        const raw = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        role: 'assistant',
                        model: '<synthetic>',
                        stop_reason: 'stop_sequence',
                        stop_sequence: '',
                        content: [{ type: 'text', text: 'No response requested.' }],
                    },
                    uuid: 'synthetic-uuid',
                },
            },
            meta: { source: 'cli' },
        } as const;

        const normalized = normalizeRawMessage(
            'msg-synthetic',
            'claude-jsonl:main:assistant:synthetic-uuid',
            1_700,
            raw,
            { seq: 12, messageRole: 'event' },
        );

        expect(normalized?.role).toBe('agent');
        expect(hasSyntheticNoResponseMeta(normalized?.meta)).toBe(true);
    });

    it('marks producer-shaped Claude synthetic no-response rows before event output filtering', () => {
        const normalized = normalizeRawMessage(
            'msg-synthetic',
            'claude-jsonl:main:assistant:synthetic-uuid',
            1_700,
            createProducerShapedSyntheticNoResponseRaw(),
            { seq: 12, messageRole: 'event' },
        );

        expect(normalized?.role).toBe('agent');
        expect(hasSyntheticNoResponseMeta(normalized?.meta)).toBe(true);
    });

    it('preserves Claude tool calls stored as event-role output rows', () => {
        const normalized = normalizeRawMessage(
            'msg-tool-call',
            'claude-jsonl:main:assistant:tool-call',
            1_700,
            {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        uuid: 'tool-call-uuid',
                        isSidechain: false,
                        message: {
                            role: 'assistant',
                            content: [{
                                type: 'tool_use',
                                id: 'toolu_1',
                                name: 'Bash',
                                input: {
                                    command: 'echo hi',
                                    description: 'Say hi',
                                },
                            }],
                        },
                    },
                },
            },
            { seq: 13, messageRole: 'event' },
        );

        expect(normalized?.role).toBe('agent');
        expect(normalized?.content).toEqual([
            expect.objectContaining({
                type: 'tool-call',
                id: 'toolu_1',
                name: 'Bash',
                description: 'Say hi',
            }),
        ]);
    });

    it('preserves Claude tool results stored as event-role output rows', () => {
        const normalized = normalizeRawMessage(
            'msg-tool-result',
            'claude-jsonl:main:user:tool-result',
            1_701,
            {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'user',
                        uuid: 'tool-result-uuid',
                        isSidechain: false,
                        toolUseResult: { stdout: 'hi\n' },
                        message: {
                            role: 'user',
                            content: [{
                                type: 'tool_result',
                                tool_use_id: 'toolu_1',
                                content: 'fallback',
                                is_error: false,
                            }],
                        },
                    },
                },
            },
            { seq: 14, messageRole: 'event' },
        );

        expect(normalized?.role).toBe('agent');
        expect(normalized?.content).toEqual([
            expect.objectContaining({
                type: 'tool-result',
                tool_use_id: 'toolu_1',
                content: expect.stringContaining('hi'),
            }),
        ]);
    });

    it('preserves renderable thinking output rows classified as events', () => {
        const normalized = normalizeRawMessage(
            'msg-thinking',
            'claude-jsonl:main:assistant:thinking',
            1_702,
            {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        uuid: 'thinking-uuid',
                        isSidechain: false,
                        message: {
                            role: 'assistant',
                            content: [{
                                type: 'thinking',
                                thinking: 'I need to inspect the repo.',
                            }],
                        },
                    },
                },
            },
            { seq: 15, messageRole: 'event' },
        );

        expect(normalized?.role).toBe('agent');
        expect(normalized?.content).toEqual([
            expect.objectContaining({
                type: 'thinking',
                thinking: 'I need to inspect the repo.',
            }),
        ]);
    });

    it('drops non-structured output rows classified as events', () => {
        const raw = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        role: 'assistant',
                        content: [{ type: 'text', text: 'Transport status' }],
                    },
                    uuid: 'event-uuid',
                },
            },
        } as const;

        expect(normalizeRawMessage('msg-event', null, 1_700, raw, { messageRole: 'event' })).toBeNull();
    });
});
