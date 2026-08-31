import {
    areWorkspaceSyncRelationshipDefinitionsEqual,
    WorkspaceSyncRelationshipV1Schema,
    type WorkspaceSyncRelationshipV1,
} from '@happier-dev/protocol';

const MAX_WORKSPACE_SYNC_RELATIONSHIPS = 32;

function mutationError(code: string): Error {
    return Object.assign(new Error(code), { code });
}

/**
 * Strict mutation-side reader for the canonical Account Settings collection.
 * Projection readers may skip malformed entries, but a writer must never erase
 * an entry it cannot understand while applying an unrelated mutation.
 */
export function parseWorkspaceSyncRelationshipRecords(raw: unknown): WorkspaceSyncRelationshipV1[] {
    if (raw === undefined) return [];
    if (!Array.isArray(raw) || raw.length > MAX_WORKSPACE_SYNC_RELATIONSHIPS) {
        throw mutationError('workspace_sync_relationship_settings_invalid');
    }
    const relationships: WorkspaceSyncRelationshipV1[] = [];
    const ids = new Set<string>();
    for (const candidate of raw) {
        const parsed = WorkspaceSyncRelationshipV1Schema.safeParse(candidate);
        if (!parsed.success || ids.has(parsed.data.relationshipId)) {
            throw mutationError('workspace_sync_relationship_settings_invalid');
        }
        ids.add(parsed.data.relationshipId);
        relationships.push(parsed.data);
    }
    return relationships;
}

export function upsertWorkspaceSyncRelationshipRecord(
    raw: unknown,
    relationship: WorkspaceSyncRelationshipV1,
): WorkspaceSyncRelationshipV1[] {
    const parsed = WorkspaceSyncRelationshipV1Schema.safeParse(relationship);
    if (!parsed.success) throw mutationError('workspace_sync_relationship_invalid');
    const relationships = parseWorkspaceSyncRelationshipRecords(raw);
    const existingIndex = relationships.findIndex(
        (candidate) => candidate.relationshipId === parsed.data.relationshipId,
    );
    if (existingIndex < 0) {
        if (relationships.length >= MAX_WORKSPACE_SYNC_RELATIONSHIPS) {
            throw mutationError('workspace_sync_relationship_limit');
        }
        return [...relationships, parsed.data];
    }
    const existing = relationships[existingIndex]!;
    if (!areWorkspaceSyncRelationshipDefinitionsEqual(existing, parsed.data)) {
        throw mutationError('workspace_sync_relationship_definition_immutable');
    }
    const updated = WorkspaceSyncRelationshipV1Schema.parse({
        ...parsed.data,
        createdAtMs: existing.createdAtMs,
    });
    return relationships.map((candidate, index) => index === existingIndex ? updated : candidate);
}

export function setWorkspaceSyncRelationshipEnabled(
    raw: unknown,
    input: Readonly<{
        relationshipId: string;
        enabled: boolean;
        updatedAtMs: number;
    }>,
): WorkspaceSyncRelationshipV1[] {
    const relationships = parseWorkspaceSyncRelationshipRecords(raw);
    const existing = relationships.find((candidate) => candidate.relationshipId === input.relationshipId);
    if (!existing) throw mutationError('workspace_sync_relationship_not_found');
    return upsertWorkspaceSyncRelationshipRecord(relationships, {
        ...existing,
        enabled: input.enabled,
        updatedAtMs: input.updatedAtMs,
    });
}

export function removeWorkspaceSyncRelationshipRecord(
    raw: unknown,
    relationshipId: string,
): WorkspaceSyncRelationshipV1[] {
    const relationships = parseWorkspaceSyncRelationshipRecords(raw);
    return relationships.filter((candidate) => candidate.relationshipId !== relationshipId);
}
