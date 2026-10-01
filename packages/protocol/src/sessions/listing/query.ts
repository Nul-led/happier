import { z } from 'zod';
import { decodeV2SessionListCursorV1, decodeV2SessionListCursorV2 } from './cursor.js';

// Shared with the ordinary V2 HTTP page. Selector counts remain subject to the
// transport/database boundaries, not an additional query-language quota.
export const SESSION_LIST_PAGE_DEFAULT_LIMIT = 50;
export const SESSION_LIST_PAGE_MAX_LIMIT = 200;

export const SessionListScopeV1Schema = z.enum([
  'my_work', 'assigned_to_me', 'following', 'involving_me', 'all_accessible',
]);
export type SessionListScopeV1 = z.infer<typeof SessionListScopeV1Schema>;

export const SessionAttentionFilterV1Schema = z.enum(['any', 'needs_my_attention']);
export type SessionAttentionFilterV1 = z.infer<typeof SessionAttentionFilterV1Schema>;

const SelectorIdSchema = z.string().trim().min(1);

// Each identity/selection object is closed, independently of the query envelope.
export const SessionAudienceSelectionV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('outside_teams') }).strict(),
  z.object({ kind: z.literal('team'), teamId: SelectorIdSchema }).strict(),
  z.object({ kind: z.literal('group'), teamId: SelectorIdSchema, groupId: SelectorIdSchema }).strict(),
]);
export type SessionAudienceSelectionV1 = Readonly<z.infer<typeof SessionAudienceSelectionV1Schema>>;

function audienceKey(audience: SessionAudienceSelectionV1): string {
  switch (audience.kind) {
    case 'outside_teams': return JSON.stringify([audience.kind]);
    case 'team': return JSON.stringify([audience.kind, audience.teamId]);
    case 'group': return JSON.stringify([audience.kind, audience.teamId, audience.groupId]);
  }
}

const AudienceSelectionsSchema = z.array(SessionAudienceSelectionV1Schema)
  .refine((values) => new Set(values.map(audienceKey)).size === values.length, {
    message: 'Duplicate audience selectors',
  })
  .transform((values) => {
    const teams = new Set(values.filter((value) => value.kind === 'team').map((value) => value.teamId));
    return values
      .filter((value) => value.kind !== 'group' || !teams.has(value.teamId))
      .sort((a, b) => {
        const left = audienceKey(a);
        const right = audienceKey(b);
        return left < right ? -1 : left > right ? 1 : 0;
      });
  });

const TagIdsSchema = z.array(SelectorIdSchema)
  .refine((values) => new Set(values).size === values.length, { message: 'Duplicate tag selectors' })
  .transform((values) => values.sort());

const FolderIdsSchema = z.array(SelectorIdSchema)
  .refine((values) => new Set(values).size === values.length, { message: 'Duplicate folder selectors' })
  .transform((values) => values.sort());

const CursorSchema = z.string().refine(
  (value) => decodeV2SessionListCursorV2(value) !== null || decodeV2SessionListCursorV1(value) !== null,
  { message: 'Invalid cursor format' },
);

/** V1 is a closed Home-local selection contract, independent of package SemVer. */
export const SessionListQueryV1Schema = z.object({
  v: z.literal(1),
  storage: z.enum(['active', 'archived']),
  includeInactive: z.boolean(),
  scope: SessionListScopeV1Schema,
  attention: SessionAttentionFilterV1Schema,
  audiences: AudienceSelectionsSchema,
  tagIds: TagIdsSchema,
  folderIds: FolderIdsSchema.optional(),
  underSessionId: SelectorIdSchema.optional(),
  cursor: CursorSchema.optional(),
  attentionCursor: CursorSchema.optional(),
  limit: z.number().int().min(1).max(SESSION_LIST_PAGE_MAX_LIMIT).optional(),
  includeAttention: z.boolean().optional(),
}).strict().refine(
  (value) => value.cursor === undefined || value.attentionCursor === undefined,
  { message: 'cursor and attentionCursor cannot be combined', path: ['attentionCursor'] },
);

export type SessionListQueryV1 = Readonly<Omit<z.infer<typeof SessionListQueryV1Schema>, 'audiences' | 'tagIds' | 'folderIds'> & {
  audiences: readonly SessionAudienceSelectionV1[];
  tagIds: readonly string[];
  folderIds?: readonly string[];
}>;

export const SessionListUnavailableQueryV1Schema = z.object({
  error: z.literal('not_found'),
  code: z.literal('filtered_session_listing_unavailable'),
  reason: z.enum(['audience', 'scope', 'following']),
}).strict();

export type SessionListUnavailableQueryV1 = Readonly<z.infer<typeof SessionListUnavailableQueryV1Schema>>;
