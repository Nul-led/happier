import type { PromptFoldersV1, PromptInvocationsV1 } from '@happier-dev/protocol';

import { findPromptFolderById } from '@/sync/ops/promptLibrary/promptFolders';
import { createHappierCollectionVisitMemory, resolveHappierCollectionInitialKey } from '@happier-dev/plugin-ui/presentation';

/**
 * The three named collections of the prompt library: prompts (`doc`), skills (`bundle`) and slash
 * templates (`template`). Each is a list beside the selected item's editor.
 */
export type PromptCollectionKind = 'doc' | 'bundle' | 'template';

const COLLECTION_ROOTS: Readonly<Record<PromptCollectionKind, string>> = {
    doc: '/settings/prompts/docs',
    bundle: '/settings/prompts/skills',
    template: '/settings/prompts/templates',
};

export function promptCollectionRoot(kind: PromptCollectionKind): string {
    return COLLECTION_ROOTS[kind];
}

export function promptCollectionItemHref(kind: PromptCollectionKind, id: string): string {
    return `${COLLECTION_ROOTS[kind]}/${encodeURIComponent(id)}`;
}

export function promptCollectionDraftHref(kind: PromptCollectionKind): string {
    return `${COLLECTION_ROOTS[kind]}/new`;
}

export type PromptCollectionRoute =
    | Readonly<{ kind: 'index' }>
    | Readonly<{ kind: 'draft' }>
    | Readonly<{ kind: 'item'; id: string }>;

/** What the route shows inside a collection: its index, the new-item draft, or an item (or one of its sub-pages). */
export function resolvePromptCollectionRoute(kind: PromptCollectionKind, pathname: string): PromptCollectionRoute | null {
    const root = COLLECTION_ROOTS[kind];
    const normalized = pathname.trim().replace(/\/+$/, '');
    if (normalized === root) return { kind: 'index' };
    if (!normalized.startsWith(`${root}/`)) return null;
    const first = normalized.slice(root.length + 1).split('/')[0] ?? '';
    if (first === 'new') return { kind: 'draft' };
    let id = first;
    try {
        id = decodeURIComponent(first);
    } catch {
        // A malformed escape is still the segment the route was opened with.
    }
    return id ? { kind: 'item', id } : { kind: 'index' };
}

export type PromptCollectionRow = Readonly<{
    id: string;
    title: string;
    /** A distinguishing fact where the collection has one (a template's slash command). */
    subtitle?: string;
}>;

export type PromptCollectionGroup = Readonly<{
    /** The folder the rows share; `null` for items outside any folder. */
    id: string | null;
    title: string | null;
    rows: readonly PromptCollectionRow[];
}>;

export type PromptCollection = Readonly<{
    /** Items in the collection before the search filter. */
    total: number;
    groups: readonly PromptCollectionGroup[];
}>;

type ArtifactLike = Readonly<{
    id: string;
    title?: string | null;
    header?: Readonly<Record<string, unknown>> | null;
}>;

const ARTIFACT_KIND: Readonly<Record<'doc' | 'bundle', string>> = {
    doc: 'prompt_doc.v2',
    bundle: 'prompt_bundle.v2',
};

function compareTitles(left: PromptCollectionRow, right: PromptCollectionRow): number {
    return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
}

export function readPromptArtifactTitle(artifact: ArtifactLike, untitledTitle: string): string {
    const headerTitle = artifact.header?.title;
    if (typeof headerTitle === 'string' && headerTitle.trim()) return headerTitle;
    return artifact.title?.trim() ? artifact.title : untitledTitle;
}

/**
 * Prompts or skills, grouped by folder (folders by name, then the items outside any folder). With no
 * item in a folder the list stays ungrouped rather than showing a heading that says nothing.
 */
export function buildPromptLibraryCollection(params: Readonly<{
    kind: 'doc' | 'bundle';
    artifacts: readonly ArtifactLike[];
    folders: PromptFoldersV1 | null | undefined;
    query: string;
    untitledTitle: string;
}>): PromptCollection {
    const members = params.artifacts.filter((artifact) => artifact.header?.kind === ARTIFACT_KIND[params.kind]);
    const query = params.query.trim().toLocaleLowerCase();
    const byFolder = new Map<string | null, { title: string | null; rows: PromptCollectionRow[] }>();
    for (const artifact of members) {
        const title = readPromptArtifactTitle(artifact, params.untitledTitle);
        const folderId = typeof artifact.header?.folderId === 'string' ? artifact.header.folderId : null;
        const folder = findPromptFolderById(params.folders ?? null, folderId);
        const tags = Array.isArray(artifact.header?.tags)
            ? (artifact.header.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
            : [];
        if (query && ![title, folder?.name ?? '', ...tags].join('\n').toLocaleLowerCase().includes(query)) continue;
        const key = folder ? folder.id : null;
        const group = byFolder.get(key) ?? { title: folder?.name ?? null, rows: [] };
        group.rows.push({ id: artifact.id, title });
        byFolder.set(key, group);
    }
    const groups: PromptCollectionGroup[] = [...byFolder.entries()]
        .filter(([id]) => id !== null)
        .map(([id, group]) => ({ id, title: group.title, rows: group.rows.sort(compareTitles) }))
        .sort((left, right) => (left.title ?? '').localeCompare(right.title ?? '', undefined, { sensitivity: 'base' }));
    const loose = byFolder.get(null);
    if (loose) groups.push({ id: null, title: null, rows: loose.rows.sort(compareTitles) });
    return { total: members.length, groups };
}

/** Slash templates, by name, each with its command. */
export function buildPromptTemplateCollection(params: Readonly<{
    invocations: Pick<PromptInvocationsV1, 'entries'> | Readonly<{ entries: readonly Readonly<{ id: string; title: string; token: string }>[] }> | null | undefined;
    query: string;
}>): PromptCollection {
    const entries = params.invocations?.entries ?? [];
    const query = params.query.trim().toLocaleLowerCase();
    const rows = entries
        .filter((entry) => !query || `${entry.title}\n${entry.token}`.toLocaleLowerCase().includes(query))
        .map((entry): PromptCollectionRow => ({ id: entry.id, title: entry.title, subtitle: entry.token }))
        .sort(compareTitles);
    return { total: entries.length, groups: rows.length > 0 ? [{ id: null, title: null, rows }] : [] };
}

/** Where a wide collection lands when its route names no item: the last one opened, else the first. */
export function resolvePromptCollectionLandingId(collection: PromptCollection, lastVisitedId: string | null): string | null {
    const ids = collection.groups.flatMap((group) => group.rows.map((row) => row.id));
    return resolveHappierCollectionInitialKey({ keys: ids, lastVisited: lastVisitedId });
}

/**
 * The item last opened in each collection during this app session. Session memory only: a
 * navigation convenience, not a preference, so it is neither persisted nor synced.
 */
const promptVisits: Record<PromptCollectionKind, ReturnType<typeof createHappierCollectionVisitMemory<string>>> = {
    doc: createHappierCollectionVisitMemory<string>(),
    bundle: createHappierCollectionVisitMemory<string>(),
    template: createHappierCollectionVisitMemory<string>(),
};

export function recordPromptCollectionVisit(kind: PromptCollectionKind, id: string): void {
    promptVisits[kind].record(id);
}

export function readLastVisitedPromptCollectionId(kind: PromptCollectionKind): string | null {
    return promptVisits[kind].read();
}
