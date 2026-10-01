import { describe, expect, it } from 'vitest';

import {
    buildPromptLibraryCollection,
    buildPromptTemplateCollection,
    resolvePromptCollectionLandingId,
    resolvePromptCollectionRoute,
} from './promptCollectionModel';

const folders = { v: 1 as const, folders: [{ id: 'f-ops', name: 'Ops', parentId: null }] };

function doc(id: string, title: string, folderId: string | null = null) {
    return { id, title, header: { kind: 'prompt_doc.v2', title, folderId } };
}

describe('prompt collections', () => {
    it('lists only the collection kind, sorted by name, with foldered items grouped under their folder first', () => {
        const collection = buildPromptLibraryCollection({
            kind: 'doc',
            artifacts: [
                doc('d-b', 'beta'),
                doc('d-a', 'Alpha', 'f-ops'),
                { id: 's-1', title: 'Skill', header: { kind: 'prompt_bundle.v2', title: 'Skill' } },
                doc('d-c', 'Gamma'),
            ],
            folders,
            query: '',
            untitledTitle: 'Untitled prompt',
        });

        expect(collection.total).toBe(3);
        expect(collection.groups.map((group) => [group.title, group.rows.map((row) => row.id)])).toEqual([
            ['Ops', ['d-a']],
            [null, ['d-b', 'd-c']],
        ]);
    });

    it('shows one ungrouped list when nothing is in a folder, and filters by name, folder and tags', () => {
        const collection = buildPromptLibraryCollection({
            kind: 'doc',
            artifacts: [
                doc('d-a', 'Review'),
                { id: 'd-t', title: 'Other', header: { kind: 'prompt_doc.v2', title: 'Other', tags: ['review'] } },
                doc('d-x', 'Unrelated'),
            ],
            folders,
            query: 'review',
            untitledTitle: 'Untitled prompt',
        });

        expect(collection.total).toBe(3);
        expect(collection.groups).toHaveLength(1);
        expect(collection.groups[0]?.title).toBeNull();
        expect(collection.groups[0]?.rows.map((row) => row.id)).toEqual(['d-t', 'd-a']);
    });

    it('lists templates with their slash command', () => {
        const collection = buildPromptTemplateCollection({
            invocations: {
                entries: [
                    { id: 't-2', title: 'Standup', token: '/standup' },
                    { id: 't-1', title: 'Daily review', token: '/daily' },
                ],
            },
            query: '',
        });

        expect(collection.groups[0]?.rows.map((row) => [row.id, row.subtitle])).toEqual([
            ['t-1', '/daily'],
            ['t-2', '/standup'],
        ]);
    });

    it('lands on the last visited item while it still exists, otherwise the first', () => {
        const collection = buildPromptLibraryCollection({
            kind: 'doc',
            artifacts: [doc('d-b', 'Beta'), doc('d-a', 'Alpha')],
            folders,
            query: '',
            untitledTitle: 'Untitled prompt',
        });

        expect(resolvePromptCollectionLandingId(collection, 'd-b')).toBe('d-b');
        expect(resolvePromptCollectionLandingId(collection, 'gone')).toBe('d-a');
        expect(resolvePromptCollectionLandingId({ total: 0, groups: [] }, null)).toBeNull();
    });

    it('reads the selected item, the draft, and sub-pages from the route', () => {
        expect(resolvePromptCollectionRoute('doc', '/settings/prompts/docs')).toEqual({ kind: 'index' });
        expect(resolvePromptCollectionRoute('doc', '/settings/prompts/docs/new')).toEqual({ kind: 'draft' });
        expect(resolvePromptCollectionRoute('doc', '/settings/prompts/docs/d-1')).toEqual({ kind: 'item', id: 'd-1' });
        expect(resolvePromptCollectionRoute('doc', '/settings/prompts/docs/d-1/export')).toEqual({ kind: 'item', id: 'd-1' });
        expect(resolvePromptCollectionRoute('bundle', '/settings/prompts/skills/s%201/files/edit')).toEqual({ kind: 'item', id: 's 1' });
        expect(resolvePromptCollectionRoute('template', '/settings/prompts/templates/new')).toEqual({ kind: 'draft' });
        expect(resolvePromptCollectionRoute('template', '/settings/prompts/stacks')).toBeNull();
    });
});
