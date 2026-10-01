import type { RawMessageNormalizationInput } from '../normalize.js';

// ACP shape comes from normalize.legacyAcpEnvelope.test.ts's persisted-session
// capture; Claude's released output envelope is shared by typesRaw.spec.ts.
export const multiAgentPage = [
  { id: 'stored-user', localId: null, createdAt: 1_000, seq: 1, messageRole: 'user',
    raw: { role: 'user', content: { type: 'text', text: 'Question' } } },
  { id: 'stored-claude', localId: null, createdAt: 1_001, seq: 2, messageRole: 'agent',
    raw: { role: 'agent', content: { type: 'output', data: {
      type: 'assistant', uuid: 'claude-block', message: {
        role: 'assistant', content: [{ type: 'text', text: 'Claude answer' }],
      },
    } } } },
  { id: 'stored-acp', localId: null, createdAt: 1_002, seq: 3, messageRole: 'agent',
    raw: { role: 'agent', content: { type: 'acp', provider: 'codex',
      data: { type: 'message', message: 'ACP answer' },
    } } },
] satisfies readonly RawMessageNormalizationInput[];
