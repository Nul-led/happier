import { describe, expect, it } from 'vitest';

import { normalizeRawMessage } from "./normalize.js";
import { RawRecordSchema } from "./schemas.js";

describe('typesRaw progress record handling', () => {
  it('accepts Codex question tool records without an event id', () => {
    const call = normalizeRawMessage('call-message', null, 1000, {
      role: 'agent', content: { type: 'codex', data: {
        type: 'tool-call', callId: 'question-1', name: 'AskUserQuestion', input: { questions: [] },
      } },
    });
    const result = normalizeRawMessage('result-message', null, 1001, {
      role: 'agent', content: { type: 'codex', data: {
        type: 'tool-call-result', callId: 'question-1', output: { answers: { Choice: ['B'] } },
      } },
    });

    expect(call).toMatchObject({ role: 'agent', content: [{ type: 'tool-call', name: 'AskUserQuestion' }] });
    expect(result).toMatchObject({ role: 'agent', content: [{ type: 'tool-result', tool_use_id: 'question-1' }] });
  });

  it('keeps a tool answer delivery out of the visible transcript', () => {
    expect(normalizeRawMessage('reply-message', 'reply-1', 1000, {
      role: 'user',
      content: { type: 'text', text: '<send_user_message_question_reply>...</send_user_message_question_reply>' },
      meta: { happier: { kind: 'tool-answer-delivery.v1', payload: { toolCallId: 'question-1' } } },
    })).toBeNull();
  });

  it.each(['completed', 'refused'])('hides a stored Claude command lifecycle frame in state %s while preserving conversation neighbors', (state) => {
    // Raw stream-json shape observed with newer Claude runtimes. SDK 0.3.206 added this
    // frame; 0.3.238 added refused. Older Happier writers stored it as output data.
    const records = [
      { role: 'user', content: { type: 'text', text: 'hello' } },
      { role: 'agent', content: { type: 'output', data: {
        type: 'command_lifecycle', command_uuid: 'command-1', session_id: 'provider-session', state, uuid: 'lifecycle-1',
      } } },
      { role: 'agent', content: { type: 'output', data: {
        type: 'assistant', uuid: 'assistant-1', message: { role: 'assistant', content: [
          { type: 'text', text: 'reply' },
          { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'pwd' } },
        ] },
      } } },
    ];
    const normalized = records.map((raw, index) => normalizeRawMessage(`message-${index}`, null, 1000 + index, raw));
    expect(normalized[0]).toMatchObject({ role: 'user', content: { type: 'text', text: 'hello' } });
    expect(normalized[1]).toBeNull();
    expect(normalized[2]).toMatchObject({ role: 'agent', content: [
      { type: 'text', text: 'reply' }, { type: 'tool-call', id: 'tool-1', name: 'Bash' },
    ] });
  });

  it('hides stored context-injection attachments classified as internal by the CLI', () => {
    expect(normalizeRawMessage('attachment', null, 1000, {
      role: 'agent', content: { type: 'output', data: {
        type: 'attachment', attachment: { type: 'hook_success', hookEvent: 'SessionStart', stdout: '{}' },
      } },
    })).toBeNull();
  });


  it('accepts output progress records and drops them during normalization', () => {
    const raw: any = {
      role: 'agent',
      content: {
        type: 'output',
        data: {
          type: 'progress',
          uuid: 'progress-1',
          status: 'running',
        },
      },
      meta: { source: 'cli' },
    };

    const parsed = RawRecordSchema.safeParse(raw);
    expect(parsed.success).toBe(true);

    const normalized = normalizeRawMessage('msg-progress', null, 1000, raw);
    expect(normalized).toBeNull();
  });

  it('accepts Claude tool_progress heartbeat records and drops them during normalization', () => {
    const raw: any = {
      role: 'agent',
      content: {
        type: 'output',
        data: {
          type: 'tool_progress',
          uuid: 'tool-progress-1',
          tool_name: 'Bash',
          tool_use_id: 'tool-1',
          elapsed_time_seconds: 30,
          heartbeat: true,
        },
      },
      meta: { source: 'cli' },
    };

    const parsed = RawRecordSchema.safeParse(raw);
    expect(parsed.success).toBe(true);

    const normalized = normalizeRawMessage('msg-tool-progress', null, 1000, raw);
    expect(normalized).toBeNull();
  });

  it.each(['turn_failed', 'turn_cancelled', 'turn_aborted'] as const)(
    'accepts codex %s records and drops them during normalization',
    (type) => {
    const raw: any = {
      role: 'agent',
      content: {
        type: 'codex',
        data: {
          type,
        },
      },
      meta: { source: 'cli' },
    };

    const parsed = RawRecordSchema.safeParse(raw);
    expect(parsed.success).toBe(true);

    const normalized = normalizeRawMessage(`msg-${type}`, null, 1000, raw);
    expect(normalized).toBeNull();
    },
  );
});
