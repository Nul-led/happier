import { z } from 'zod';

import {
    SessionAttentionFilterV1Schema,
    SessionAudienceSelectionV1Schema,
    SessionListScopeV1Schema,
    type SessionAttentionFilterV1,
    type SessionListScopeV1,
    type SessionAudienceSelectionV1,
} from '../listing/query.js';

export type QualifiedAudienceSelection = Readonly<{ serverId: string }> & SessionAudienceSelectionV1;
export type QualifiedTagAddress = Readonly<{ serverId: string; tagId: string }>;

export const SessionListShowV1Schema = z.enum(['sessions', 'runs', 'both']);
export const SessionListStartedByV1Schema = z.enum(['you', 'triggers', 'agents']);

/** Serializable selection shared by the Sessions list and inline Board filters. */
export type SessionListFilterV1 = Readonly<{
    show: z.infer<typeof SessionListShowV1Schema>;
    startedBy: readonly z.infer<typeof SessionListStartedByV1Schema>[];
    scope: SessionListScopeV1;
    attention: SessionAttentionFilterV1;
    homeServerIds: readonly string[];
    audiences: readonly QualifiedAudienceSelection[];
    tagIds: readonly QualifiedTagAddress[];
    source: 'all' | 'persisted' | 'direct';
}>;

export type SessionListFilterDefaultsInputV1 = Partial<SessionListFilterV1>;

function normalizeId(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim() : '';
}

export function normalizeSessionListFilterHomeIds(values: readonly string[] | undefined): string[] {
    const seen = new Set<string>();
    const next: string[] = [];
    for (const raw of values ?? []) {
        const value = normalizeId(raw);
        if (!value || seen.has(value)) continue;
        seen.add(value);
        next.push(value);
    }
    return next;
}

function normalizeAudience(audience: QualifiedAudienceSelection): QualifiedAudienceSelection | null {
    const serverId = normalizeId(audience.serverId);
    if (!serverId) return null;
    if (audience.kind === 'outside_teams') return { serverId, kind: 'outside_teams' };
    const teamId = normalizeId(audience.teamId);
    if (!teamId) return null;
    if (audience.kind === 'team') return { serverId, kind: 'team', teamId };
    const groupId = normalizeId(audience.groupId);
    return groupId ? { serverId, kind: 'group', teamId, groupId } : null;
}

export function buildQualifiedAudienceSelectionKey(audience: QualifiedAudienceSelection): string {
    if (audience.kind === 'outside_teams') return JSON.stringify([normalizeId(audience.serverId), audience.kind]);
    if (audience.kind === 'team') {
        return JSON.stringify([normalizeId(audience.serverId), audience.kind, normalizeId(audience.teamId)]);
    }
    return JSON.stringify([
        normalizeId(audience.serverId), audience.kind, normalizeId(audience.teamId), normalizeId(audience.groupId),
    ]);
}

export function buildQualifiedTagAddressKey(address: QualifiedTagAddress): string {
    return JSON.stringify([normalizeId(address.serverId), normalizeId(address.tagId)]);
}

export function normalizeSessionListFilterAudiences(
    values: readonly QualifiedAudienceSelection[] | undefined,
): QualifiedAudienceSelection[] {
    const seen = new Set<string>();
    const next: QualifiedAudienceSelection[] = [];
    for (const value of values ?? []) {
        const normalized = normalizeAudience(value);
        if (!normalized) continue;
        const key = buildQualifiedAudienceSelectionKey(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(normalized);
    }
    return next;
}

export function normalizeSessionListFilterTagIds(values: readonly QualifiedTagAddress[] | undefined): QualifiedTagAddress[] {
    const seen = new Set<string>();
    const next: QualifiedTagAddress[] = [];
    for (const value of values ?? []) {
        const serverId = normalizeId(value.serverId);
        const tagId = normalizeId(value.tagId);
        if (!serverId || !tagId) continue;
        const normalized = { serverId, tagId };
        const key = buildQualifiedTagAddressKey(normalized);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(normalized);
    }
    return next;
}

/** Retains the live list's defaults, identity qualification, order and deduplication. */
export function normalizeSessionListFilterV1(input: SessionListFilterDefaultsInputV1 = {}): SessionListFilterV1 {
    return {
        show: input.show ?? 'both',
        startedBy: [...new Set<SessionListFilterV1['startedBy'][number]>(input.startedBy ?? ['you'])],
        scope: input.scope ?? 'my_work',
        attention: input.attention ?? 'any',
        homeServerIds: normalizeSessionListFilterHomeIds(input.homeServerIds),
        audiences: normalizeSessionListFilterAudiences(input.audiences),
        tagIds: normalizeSessionListFilterTagIds(input.tagIds),
        source: input.source ?? 'all',
    };
}

const SelectionIdSchema = z.string().trim().min(1);
const QualifiedAudienceSelectionSchema = z.discriminatedUnion('kind', [
    SessionAudienceSelectionV1Schema.options[0].extend({ serverId: SelectionIdSchema }).strict(),
    SessionAudienceSelectionV1Schema.options[1].extend({ serverId: SelectionIdSchema }).strict(),
    SessionAudienceSelectionV1Schema.options[2].extend({ serverId: SelectionIdSchema }).strict(),
]);

/** V1 selection envelope and nested qualified identities are closed; UI state is never serialized. */
export const SessionListFilterFieldsV1Schema = z.object({
    show: SessionListShowV1Schema,
    startedBy: z.array(SessionListStartedByV1Schema),
    scope: SessionListScopeV1Schema,
    attention: SessionAttentionFilterV1Schema,
    homeServerIds: z.array(z.string()),
    audiences: z.array(QualifiedAudienceSelectionSchema),
    tagIds: z.array(z.object({ serverId: SelectionIdSchema, tagId: SelectionIdSchema }).strict()),
    source: z.enum(['all', 'persisted', 'direct']),
}).strict();

export const SessionListFilterV1Schema = SessionListFilterFieldsV1Schema
    .transform((value): SessionListFilterV1 => normalizeSessionListFilterV1(value));
