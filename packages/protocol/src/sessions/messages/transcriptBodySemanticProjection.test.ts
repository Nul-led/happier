import { describe, expect, it } from 'vitest';

import * as protocol from '../../index.js';

describe('projectTranscriptBodySearchableText', () => {
  it('projects protocol-valid ACP tool-result content that transcript readers expose', () => {
    expect(protocol.projectTranscriptBodySearchableText({
      role: 'agent',
      content: {
        type: 'acp',
        agentId: 'opencode',
        data: {
          type: 'tool-result',
          callId: 'call-1',
          id: 'tool-result-1',
          output: [{ type: 'text', text: 'protocol visible tool evidence' }],
        },
      },
    })).toBe('Tool result: protocol visible tool evidence');
  });

  it('projects output-wrapper assistant text and ignores unsupported system text', () => {
    expect(protocol.projectTranscriptBodySearchableText({
      role: 'agent',
      content: {
        type: 'output',
        data: {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'nested assistant text' }],
          },
        },
      },
    })).toBe('nested assistant text');
    expect(protocol.projectTranscriptBodySearchableText({
      role: 'agent',
      content: { type: 'acp', data: { type: 'text', role: 'system', text: 'hidden system prompt' } },
    })).toBe('');
  });
});
