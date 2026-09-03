import { describe, expect, it } from 'vitest';

import { tokenizeMemoryText } from './tokenizeMemoryText';

describe('tokenizeMemoryText', () => {
  it('keeps ASCII word and identifier matching', () => {
    expect(tokenizeMemoryText('Resolve resolveAbsolutePath in session_handoff v2!')).toEqual([
      'resolve',
      'resolveabsolutepath',
      'in',
      'session',
      'handoff',
      'v2',
    ]);
  });

  it('indexes representative non-Latin scripts instead of returning nothing', () => {
    for (const text of ['Привет мир', 'Καλημέρα κόσμε', 'مرحبا بالعالم', 'שלום עולם', 'Café déjà vu']) {
      expect(tokenizeMemoryText(text).length, text).toBeGreaterThan(0);
    }

    expect(tokenizeMemoryText('Привет МИР')).toEqual(['привет', 'мир']);
  });

  it('produces overlapping tokens for unspaced CJK documents and queries', () => {
    const documentTerms = new Set(tokenizeMemoryText('メモリ検索機能を実装した'));
    for (const term of tokenizeMemoryText('検索')) {
      expect(documentTerms.has(term), term).toBe(true);
    }

    const hanDocument = new Set(tokenizeMemoryText('我们讨论了内存搜索'));
    for (const term of tokenizeMemoryText('搜索')) {
      expect(hanDocument.has(term), term).toBe(true);
    }
  });

  it('treats emoji as separators without dropping the adjacent words', () => {
    expect(tokenizeMemoryText('deploy🚀now')).toEqual(['deploy', 'now']);
    expect(tokenizeMemoryText('🚀')).toEqual([]);
  });

  it('deduplicates terms while preserving first-occurrence order', () => {
    expect(tokenizeMemoryText('alpha beta alpha')).toEqual(['alpha', 'beta']);
  });

  it('applies minLength only to non-CJK terms', () => {
    expect(tokenizeMemoryText('a bb ccc dddd', { minLength: 3 })).toEqual(['ccc', 'dddd']);
    expect(tokenizeMemoryText('検索', { minLength: 3 }).length).toBeGreaterThan(0);
  });
});
