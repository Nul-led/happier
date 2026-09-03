import { describe, expect, it } from 'vitest';

import type { MemoryIndexableTranscriptItem } from '../transcript/indexableItem';
import { buildMemoryShardSearchKeywords } from './buildMemoryShardSearchKeywords';

function item(text: string): MemoryIndexableTranscriptItem {
  return {
    sessionId: 's1',
    id: 'm1',
    seq: 1,
    createdAtMs: 1,
    role: 'user',
    kind: 'user_message',
    text,
    textChars: text.length,
  };
}

describe('buildMemoryShardSearchKeywords', () => {
  it('keeps model keywords first and drops short ASCII noise', () => {
    expect(
      buildMemoryShardSearchKeywords({
        modelKeywords: ['OpenClaw'],
        items: [item('we shipped the memory index in v2')],
      }),
    ).toEqual(['OpenClaw', 'shipped', 'the', 'memory', 'index']);
  });

  it('derives keywords from non-ASCII transcripts instead of returning nothing', () => {
    const keywords = buildMemoryShardSearchKeywords({
      modelKeywords: [],
      items: [item('Обсудили メモリ検索機能 и Καλημέρα')],
    });
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords).toContain('обсудили');
    expect(keywords).toContain('検索');
  });
});
