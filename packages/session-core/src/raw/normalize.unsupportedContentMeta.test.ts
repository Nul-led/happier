import { describe, expect, it } from 'vitest';
import { readReleasedOutputNonTranscriptRecordTypes } from '@happier-dev/agents';

import { normalizeRawMessage } from "./normalize.js";
import { readUnsupportedContentMeta } from "../messages/unsupportedContentMeta.js";

describe('normalizeRawMessage unsupported-content meta marking', () => {
    it('hides released output bookkeeping declared by the generated agent definitions', () => {
        // cli-v0.2.11@98ea8fb wraps the entire Claude JSONL body in this output envelope.
        expect(readReleasedOutputNonTranscriptRecordTypes().has('queue-operation')).toBe(true);
        expect(normalizeRawMessage('released-queue', null, 1000, {
            role: 'agent', content: { type: 'output', data: { type: 'queue-operation' } },
        })).toBeNull();
    });
    it('marks a Zod parse failure for a user record as unparsed-user-message', () => {
        const raw = {
            role: 'user',
            // `content.type` outside the known 'output' | 'event' | 'codex' | 'acp' union fails schema validation.
            content: { type: 'totally-unknown-content-type' },
        };

        const normalized = normalizeRawMessage('msg-1', null, 1000, raw);
        expect(normalized).not.toBeNull();
        if (!normalized) return;
        expect(normalized.role).toBe('user');
        expect(readUnsupportedContentMeta(normalized.meta)).toBe('unparsed-user-message');
    });

    it('marks a Zod parse failure for an agent record as unparsed-agent-message', () => {
        const raw = {
            role: 'agent',
            content: { type: 'totally-unknown-content-type' },
        };

        const normalized = normalizeRawMessage('msg-2', null, 1000, raw);
        expect(normalized).not.toBeNull();
        if (!normalized) return;
        expect(normalized.role).toBe('agent');
        expect(readUnsupportedContentMeta(normalized.meta)).toBe('unparsed-agent-message');
    });

    it('marks an unrecognized output payload as unsupported-agent-output', () => {
        const raw = {
            role: 'agent',
            content: {
                type: 'output',
                data: { type: 'some_future_output_type' },
            },
        };

        const normalized = normalizeRawMessage('msg-3', null, 1000, raw);
        expect(normalized).not.toBeNull();
        if (!normalized) return;
        expect(normalized.role).toBe('agent');
        expect(readUnsupportedContentMeta(normalized.meta)).toBe('unsupported-agent-output');
    });

    it('marks an unrecognized ACP data payload as unsupported-transcript-record', () => {
        const raw = {
            role: 'agent',
            content: {
                type: 'acp',
                provider: 'some-provider',
                // `agentId` is required by this repo's ACP envelope. Without it the record fails the
                // shared schema and is marked `unparsed-agent-message` before the ACP branch runs,
                // so the fixture would assert the wrong contract.
                agentId: 'agent-1',
                data: { type: 'some_future_acp_type' },
            },
        };

        const normalized = normalizeRawMessage('msg-4', null, 1000, raw);
        expect(normalized).not.toBeNull();
        if (!normalized) return;
        expect(normalized.role).toBe('agent');
        expect(readUnsupportedContentMeta(normalized.meta)).toBe('unsupported-transcript-record');
    });
});
