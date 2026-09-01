import { describe, expect, it } from 'vitest';

import { createPiRuntimeEventProjector } from './events.js';

const context = {
  sessionId: 'session-1',
  turnId: 'turn-1',
  agentSessionId: 'pi-session-1',
  nowMs: () => 1,
} as const;

type ProjectedEvents = ReturnType<ReturnType<typeof createPiRuntimeEventProjector>['project']>;

function channelTexts(events: ProjectedEvents, channel: 'assistant' | 'reasoning'): string[] {
  return events
    .filter((event) => event.kind === 'message-delta' && event.channel === channel)
    .map((event) => event.text);
}

function reasoningTexts(events: ProjectedEvents): string[] {
  return channelTexts(events, 'reasoning');
}

function assistantTexts(events: ProjectedEvents): string[] {
  return channelTexts(events, 'assistant');
}

describe('createPiRuntimeEventProjector assistant snapshots', () => {
  it('reconciles authoritative snapshots within each assistant segment across tool boundaries', () => {
    const projector = createPiRuntimeEventProjector();

    expect(assistantTexts(projector.project({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Progress update.' },
    }, context))).toEqual(['Progress update.']);
    expect(assistantTexts(projector.project({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Progress update.' },
      message: { role: 'assistant', content: [{ type: 'text', text: 'Progress update.' }] },
    }, context))).toEqual([]);
    expect(assistantTexts(projector.project({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Progress update.' }] },
    }, context))).toEqual([]);

    projector.project({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'Read',
      args: {},
    }, context);

    expect(assistantTexts(projector.project({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Final answer.' },
      message: { role: 'assistant', content: [{ type: 'text', text: 'Final answer.' }] },
    }, context))).toEqual(['Final answer.']);
  });

  it('does not treat a shared prefix from an earlier assistant segment as streamed current text', () => {
    const projector = createPiRuntimeEventProjector();

    projector.project({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Shared prefix' },
    }, context);
    projector.project({
      type: 'tool_execution_start',
      toolCallId: 'tool-1',
      toolName: 'Read',
      args: {},
    }, context);

    expect(assistantTexts(projector.project({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Shared prefix continued' }] },
    }, context))).toEqual(['Shared prefix continued']);
  });
});

describe('createPiRuntimeEventProjector reasoning', () => {
  it('streams thinking deltas and appends only the missing authoritative suffix', () => {
    const projector = createPiRuntimeEventProjector();

    expect(reasoningTexts(projector.project({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'I should ' },
    }, context))).toEqual(['I should ']);

    expect(reasoningTexts(projector.project({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'I should finish.' }],
      },
    }, context))).toEqual(['finish.']);
  });

  it('publishes a complete snapshot when no thinking deltas were observed', () => {
    const projector = createPiRuntimeEventProjector();

    expect(reasoningTexts(projector.project({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'final thought' }],
      },
    }, context))).toEqual(['final thought']);
  });

  it('surfaces divergent snapshots and clears reconciliation state between messages and turns', () => {
    const projector = createPiRuntimeEventProjector();

    projector.project({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'partial' },
    }, context);
    expect(reasoningTexts(projector.project({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'authoritative' }],
      },
    }, context))).toEqual(['\n\nauthoritative']);

    expect(reasoningTexts(projector.project({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'next message' }],
      },
    }, context))).toEqual(['next message']);

    projector.project({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'old turn' },
    }, context);
    projector.resetTurn();
    expect(reasoningTexts(projector.project({
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'new turn' }],
      },
    }, context))).toEqual(['new turn']);
  });
});
