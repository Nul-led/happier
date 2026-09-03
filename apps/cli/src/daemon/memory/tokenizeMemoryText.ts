/**
 * Canonical tokenizer for every daemon memory search term: summary shard terms,
 * deep chunk terms, and the generated shard search keywords.
 *
 * Documents and queries are tokenized by this same owner, so the contract is
 * simply that the same word written in the same script produces overlapping
 * tokens. Words are separated by anything that is not a letter, number, or
 * combining mark, which keeps ASCII identifier matching (`session_handoff` ->
 * `session`, `handoff`) while treating punctuation and emoji as separators.
 *
 * Scripts that do not put spaces between words (Han, Hiragana, Katakana,
 * Hangul) would otherwise collapse a whole sentence into one unmatchable term,
 * so their runs are additionally emitted as character unigrams and bigrams.
 */

const TOKEN_SEPARATOR_PATTERN = /[^\p{L}\p{N}\p{M}]+/u;
const UNSPACED_SCRIPT_CLASS = '[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]';
const UNSPACED_SCRIPT_PATTERN = new RegExp(UNSPACED_SCRIPT_CLASS, 'u');
const UNSPACED_SCRIPT_RUN_PATTERN = new RegExp(`${UNSPACED_SCRIPT_CLASS}+`, 'gu');

/** Terms longer than this are truncated identically on both sides of a search. */
const MAX_MEMORY_TERM_CHARS = 64;

export type TokenizeMemoryTextOptions = Readonly<{
  /**
   * Minimum length for spaced-script terms. Unigrams and bigrams derived from
   * unspaced scripts are always kept: there they carry the word, not noise.
   */
  minLength?: number;
}>;

export function tokenizeMemoryText(text: string, options?: TokenizeMemoryTextOptions): string[] {
  const raw = String(text ?? '');
  if (!raw) return [];
  const minLength = Number.isFinite(options?.minLength) ? Math.max(1, Math.trunc(options!.minLength!)) : 1;

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (candidate: string, enforceMinLength: boolean): void => {
    const chars = Array.from(candidate);
    const term = chars.length > MAX_MEMORY_TERM_CHARS ? chars.slice(0, MAX_MEMORY_TERM_CHARS).join('') : candidate;
    if (!term) return;
    if (enforceMinLength && Array.from(term).length < minLength) return;
    if (seen.has(term)) return;
    seen.add(term);
    out.push(term);
  };
  const pushUnspacedRun = (run: string): void => {
    const chars = Array.from(run);
    for (const char of chars) push(char, false);
    for (let i = 0; i + 1 < chars.length; i += 1) push(`${chars[i]}${chars[i + 1]}`, false);
  };

  for (const word of raw.normalize('NFKC').toLowerCase().split(TOKEN_SEPARATOR_PATTERN)) {
    if (!word) continue;
    if (!UNSPACED_SCRIPT_PATTERN.test(word)) {
      push(word, true);
      continue;
    }
    let lastIndex = 0;
    UNSPACED_SCRIPT_RUN_PATTERN.lastIndex = 0;
    for (let match = UNSPACED_SCRIPT_RUN_PATTERN.exec(word); match; match = UNSPACED_SCRIPT_RUN_PATTERN.exec(word)) {
      if (match.index > lastIndex) push(word.slice(lastIndex, match.index), true);
      pushUnspacedRun(match[0]);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < word.length) push(word.slice(lastIndex), true);
  }

  return out;
}
