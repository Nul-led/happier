import { z } from 'zod';

export const MemorySearchScopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }).passthrough(),
  z.object({ type: z.literal('session'), sessionId: z.string().min(1) }).passthrough(),
]);
export type MemorySearchScope = z.infer<typeof MemorySearchScopeSchema>;

export const MemorySearchModeSchema = z.enum(['hints', 'deep', 'auto']);
export type MemorySearchMode = z.infer<typeof MemorySearchModeSchema>;

// Stable error code vocabulary for memory RPC + action surfaces.
export const MemorySearchErrorCodeSchema = z.enum([
  'memory_disabled',
  'memory_key_unavailable',
  'memory_index_missing',
  'memory_invalid_query',
  'memory_failed',
]);
export type MemorySearchErrorCode = z.infer<typeof MemorySearchErrorCodeSchema>;

export const MemoryCitationV1Schema = z.object({
  sessionId: z.string().min(1),
  seqFrom: z.number().int().min(0),
  seqTo: z.number().int().min(0),
}).passthrough().superRefine((value, ctx) => {
  if (value.seqFrom > value.seqTo) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'seqFrom must be <= seqTo', path: ['seqFrom'] });
  }
});
export type MemoryCitationV1 = z.infer<typeof MemoryCitationV1Schema>;

export const MemorySearchHitV1Schema = z.object({
  sessionId: z.string().min(1),
  seqFrom: z.number().int().min(0),
  seqTo: z.number().int().min(0),
  createdAtFromMs: z.number().int().min(0),
  createdAtToMs: z.number().int().min(0),
  summary: z.string().min(1),
  score: z.number().min(0).max(1),
}).passthrough().superRefine((value, ctx) => {
  if (value.seqFrom > value.seqTo) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'seqFrom must be <= seqTo', path: ['seqFrom'] });
  }
  if (value.createdAtFromMs > value.createdAtToMs) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'createdAtFromMs must be <= createdAtToMs', path: ['createdAtFromMs'] });
  }
});
export type MemorySearchHitV1 = z.infer<typeof MemorySearchHitV1Schema>;

/**
 * One shared query-length bound for every memory-search consumer (Home FTS route, daemon RPC,
 * and their UI/CLI adapters).
 *
 * Measured at the real Home FTS5 boundary on 2026-09-01: the term-per-query cost is superlinear
 * once a query stops being a query. 1,000 terms ran in 10ms and 10,000 terms in 289ms, but a
 * 50,000-term query blocked the synchronous SQLite call for 16.1s, and a 20,000-character CJK run
 * (which the index expands into overlapping unigrams/bigrams) blocked for 4.9s. A single
 * authenticated request must not be able to occupy the server that long, so the bound protects the
 * request path rather than expressing a product preference. 1,024 characters keeps the worst
 * observed shape (an all-CJK run, ~2 tokens per character) inside the cheap 10ms–300ms band while
 * staying far above any real search box input.
 */
export const MEMORY_SEARCH_QUERY_MAX_LENGTH = 1024;

export const MemorySearchQueryV1Schema = z.object({
  v: z.literal(1),
  query: z.string().min(1).max(MEMORY_SEARCH_QUERY_MAX_LENGTH),
  scope: MemorySearchScopeSchema,
  mode: MemorySearchModeSchema,
  /**
   * Optional caller-owned contextual eligibility. Current providers apply it
   * before their result limit. Absence preserves the released global/session
   * request semantics; older tolerant readers may ignore the additive field.
   */
  eligibleSessionIds: z.array(z.string().min(1)).optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  minScore: z.number().min(0).max(1).optional(),
}).passthrough();
export type MemorySearchQueryV1 = z.infer<typeof MemorySearchQueryV1Schema>;

export const MemorySearchResultV1Schema = z.union([
  z.object({
    v: z.literal(1),
    ok: z.literal(true),
    hits: z.array(MemorySearchHitV1Schema),
  }).passthrough(),
  z.object({
    v: z.literal(1),
    ok: z.literal(false),
    errorCode: MemorySearchErrorCodeSchema,
    error: z.string().min(1),
  }).passthrough(),
]);
export type MemorySearchResultV1 = z.infer<typeof MemorySearchResultV1Schema>;
