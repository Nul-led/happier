import type { MemoryIndexableTranscriptItem } from '../transcript/indexableItem';
import { tokenizeMemoryText } from '../tokenizeMemoryText';

const MAX_MEMORY_SHARD_SEARCH_KEYWORDS = 128;
const MAX_MEMORY_SHARD_SEARCH_KEYWORD_CHARS = 128;
const MIN_MEMORY_SHARD_SEARCH_KEYWORD_CHARS = 3;

export function buildMemoryShardSearchKeywords(params: Readonly<{
  modelKeywords: readonly string[];
  items: readonly MemoryIndexableTranscriptItem[];
}>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const keyword = String(raw ?? '').trim().slice(0, MAX_MEMORY_SHARD_SEARCH_KEYWORD_CHARS);
    if (!keyword) return;
    const key = keyword.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(keyword);
  };

  for (const keyword of params.modelKeywords) add(keyword);
  for (const item of params.items) {
    for (const keyword of tokenizeMemoryText(item.text, { minLength: MIN_MEMORY_SHARD_SEARCH_KEYWORD_CHARS })) {
      add(keyword);
      if (out.length >= MAX_MEMORY_SHARD_SEARCH_KEYWORDS) return out;
    }
  }
  return out.slice(0, MAX_MEMORY_SHARD_SEARCH_KEYWORDS);
}
