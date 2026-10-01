import { describe, expect, it } from 'vitest';

import { projectCodexRolloutRecord } from './actions.js';
import { createCodexRolloutSemanticTracker } from '../semanticTracker.js';

/**
 * Shapes taken from real rollout files written by the pinned recorder
 * (`session_meta.payload.cli_version` `0.145.0`) plus the pre-frontier files the
 * same reader still opens. A durable row this projector calls `unsupported`
 * fails the whole external-session page, so the grammar has to match what the
 * recorder actually persists rather than the subset Happier consumes.
 */
function project(value: unknown) {
  return projectCodexRolloutRecord(value, { debug: false });
}

describe('pinned Codex recorder grammar', () => {
  it.each([
    ['token_count', { type: 'token_count', info: { total_token_usage: { input_tokens: 1 } } }],
    ['task_started', { type: 'task_started', turn_id: 't', started_at: 1, model_context_window: 258400 }],
    ['task_complete', { type: 'task_complete', turn_id: 't' }],
    ['turn_aborted', { type: 'turn_aborted', reason: 'interrupted' }],
    ['context_compacted', { type: 'context_compacted' }],
    ['thread_settings_applied', { type: 'thread_settings_applied' }],
    ['sub_agent_activity', { type: 'sub_agent_activity', event_id: 'call_1', agent_thread_id: 'th', kind: 'interacted' }],
    ['patch_apply_end', { type: 'patch_apply_end', call_id: 'call_1', success: true }],
    ['web_search_end', { type: 'web_search_end', call_id: 'call_1', query: 'q' }],
    ['mcp_tool_call_end', { type: 'mcp_tool_call_end', call_id: 'call_1' }],
    ['agent_reasoning', { type: 'agent_reasoning', text: 'thinking out loud' }],
    ['user_message', { type: 'user_message', message: 'hello', images: [] }],
    ['exec_command_end', { type: 'exec_command_end', call_id: 'call_1', exit_code: 0 }],
    ['thread_rolled_back', { type: 'thread_rolled_back', num_turns: 1 }],
  ])('advances past the durable content-free event_msg row %s', (_label, payload) => {
    const projected = project({ timestamp: 'ts', type: 'event_msg', payload });
    expect(projected.disposition).toBe('known');
    expect(projected.actions).toEqual([]);
  });

  it.each([
    ['compacted', { type: 'compacted', payload: { message: '', replacement_history: [] } }],
    ['world_state', { type: 'world_state', payload: { full: true, state: {} } }],
    ['inter_agent_communication_metadata', { type: 'inter_agent_communication_metadata', payload: { trigger_turn: true } }],
  ])('advances past the durable content-free envelope %s', (_label, record) => {
    const projected = project({ timestamp: 'ts', ...record });
    expect(projected.disposition).toBe('known');
    expect(projected.actions).toEqual([]);
  });

  it.each([
    ['reasoning', { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'gAAA' }],
    ['reasoning with a summary', { type: 'reasoning', summary: [{ type: 'summary_text', text: 'planning' }] }],
    ['ghost_snapshot', { type: 'ghost_snapshot', ghost_commit: { id: 'abc', parent: 'def' } }],
    ['web_search_call', { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'q' } }],
    ['agent_message', { type: 'agent_message', author: '/root', recipient: '/root/child', content: [{ type: 'input_text', text: 'NEW_TASK' }] }],
  ])('advances past the durable content-free response item %s', (_label, payload) => {
    const projected = project({ timestamp: 'ts', type: 'response_item', payload });
    expect(projected.disposition).toBe('known');
    expect(projected.actions).toEqual([]);
  });

  it('publishes the assistant turn the pinned recorder only writes as event_msg/agent_message', () => {
    const projected = project({
      timestamp: 'ts',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'the answer' },
    });
    expect(projected).toEqual({
      disposition: 'known',
      actions: [{ type: 'assistant-text', text: 'the answer' }],
    });
  });

  it('publishes a pre-frontier assistant turn exactly once when both carriers are present', () => {
    const tracker = createCodexRolloutSemanticTracker();
    const emitted = [
      { timestamp: 'ts', type: 'event_msg', payload: { type: 'agent_message', message: 'the answer' } },
      { timestamp: 'ts', type: 'event_msg', payload: { type: 'token_count', info: {} } },
      { timestamp: 'ts', type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'planning' }] } },
      {
        timestamp: 'ts',
        type: 'response_item',
        payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'the answer' }] },
      },
    ].flatMap((record) => project(record).actions.flatMap((action) => tracker.consume(action)));
    expect(emitted).toEqual([{ type: 'assistant-text', text: 'the answer' }]);
  });

  /**
   * Shapes observed in real rollouts written by `cli_version` `0.157.1`. Every
   * recent rollout on a busy machine carries at least one of them, so refusing
   * them fails nearly every page of a current Codex session.
   */
  it.each([
    ['token_usage_record envelope', {
      type: 'token_usage_record',
      payload: {
        thread_id: 'th',
        turn_id: 't',
        session_id: 'root',
        response_id: 'resp_1',
        usage: { input_tokens: 32804, cached_input_tokens: 0, output_tokens: 12 },
      },
    }],
    ['response_item compaction', {
      type: 'response_item',
      payload: { type: 'compaction', id: 'cmp_1', encrypted_content: 'gAAAA' },
    }],
    ['event_msg item_completed SubAgentActivity', {
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        thread_id: 'th',
        turn_id: 't',
        item: { type: 'SubAgentActivity', id: 'subagent-completed-1', kind: 'completed', agent_thread_id: 'child', agent_path: '/root/child' },
      },
    }],
    ...([
      ['Reasoning', { summary_text: [], raw_content: [] }],
      ['AgentMessage', { content: [{ type: 'Text', text: 'already published from response_item' }] }],
      ['CommandExecution', { command: ['/bin/bash', '-lc', 'ls'], cwd: 'file:///repo' }],
      ['FileChange', { changes: {} }],
      ['McpToolCall', { server: 'happier', tool: 'change_title', status: 'completed' }],
      ['CollabAgentToolCall', { tool: 'wait', status: 'completed' }],
      ['ContextCompaction', {}],
      ['Extension', { kind: 'web.search', query: 'q' }],
      ['ImageView', { path: 'file:///tmp/a.png' }],
    ] as const).map(([itemType, fields]) => [`event_msg item_completed ${itemType}`, {
      type: 'event_msg',
      payload: { type: 'item_completed', thread_id: 'th', turn_id: 't', item: { type: itemType, id: 'i1', ...fields } },
    }] as const),
    ['event_msg thread_goal_updated', {
      type: 'event_msg',
      payload: { type: 'thread_goal_updated', threadId: 'th', turnId: 't', goal: { objective: 'o' } },
    }],
    ['event_msg thread_name_updated', {
      type: 'event_msg',
      payload: { type: 'thread_name_updated', thread_id: 'th', thread_name: 'AGENT2' },
    }],
    ['event_msg collab_agent_interaction_end', {
      type: 'event_msg',
      payload: { type: 'collab_agent_interaction_end', call_id: 'c', receiver_thread_id: 'child', status: { completed: 'done' } },
    }],
    ['event_msg collab_resume_end', {
      type: 'event_msg',
      payload: { type: 'collab_resume_end', call_id: 'c', receiver_thread_id: 'child', status: { completed: 'done' } },
    }],
    ['event_msg error', {
      type: 'event_msg',
      payload: { type: 'error', message: 'Codex ran out of room in the model context window.', codex_error_info: 'context_window_exceeded' },
    }],
    ['response_item tool_search_call', {
      type: 'response_item',
      payload: { type: 'tool_search_call', call_id: 'c', status: 'completed', arguments: { query: 'q' } },
    }],
    ['response_item tool_search_output', {
      type: 'response_item',
      payload: { type: 'tool_search_output', call_id: 'c', status: 'completed', tools: [] },
    }],
    ['event_msg item_completed UserMessage mirror', {
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        thread_id: 'th',
        turn_id: 't',
        item: { type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'already published from response_item' }] },
      },
    }],
  ])('advances past the 0.157 content-free record %s', (_label, record) => {
    const projected = project({ timestamp: 'ts', ...record });
    expect(projected.disposition).toBe('known');
    expect(projected.actions).toEqual([]);
  });

  it('still refuses an item_completed item family it does not know', () => {
    expect(project({
      timestamp: 'ts',
      type: 'event_msg',
      payload: { type: 'item_completed', item: { type: 'NotARealCodexItem' } },
    }).disposition).toBe('unsupported');
  });

  it('still refuses a genuinely unknown durable row', () => {
    expect(project({ timestamp: 'ts', type: 'event_msg', payload: { type: 'not_a_real_codex_event' } }).disposition)
      .toBe('unsupported');
    expect(project({ timestamp: 'ts', type: 'not_a_real_codex_envelope', payload: {} }).disposition)
      .toBe('unsupported');
  });
});
