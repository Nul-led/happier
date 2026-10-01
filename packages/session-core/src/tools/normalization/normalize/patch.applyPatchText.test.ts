import { describe, expect, it } from 'vitest';

import { normalizeToolInputForRendering } from "./inputNormalization.js";

describe('normalizeToolInputForRendering (Patch apply_patch patchText)', () => {
    it('infers changes from apply_patch patchText blocks', () => {
        const normalized = normalizeToolInputForRendering({
            toolName: 'Patch',
            canonicalToolName: 'Patch',
            input: {
                patchText: [
                    '*** Begin Patch',
                    '*** Update File: src/a.txt',
                    '*** Add File: src/new.txt',
                    '*** Delete File: src/old.txt',
                    '*** End Patch',
                ].join('\n'),
            },
        });

        expect(normalized).toEqual(
            expect.objectContaining({
                changes: {
                    'src/a.txt': expect.objectContaining({ type: 'update' }),
                    'src/new.txt': expect.objectContaining({ type: 'add', add: { content: '' } }),
                    'src/old.txt': expect.objectContaining({ type: 'delete', delete: { content: '' } }),
                },
            }),
        );
    });

    it('tracks move destinations for renamed apply_patch file blocks', () => {
        const normalized = normalizeToolInputForRendering({
            toolName: 'Patch',
            canonicalToolName: 'Patch',
            input: {
                patchText: [
                    '*** Begin Patch',
                    '*** Update File: src/old-name.ts',
                    '*** Move to: src/new-name.ts',
                    '@@',
                    '-old',
                    '+new',
                    '*** End Patch',
                ].join('\n'),
            },
        });

        expect(normalized).toEqual(
            expect.objectContaining({
                changes: {
                    'src/new-name.ts': expect.objectContaining({
                        type: 'update',
                        previous_file_path: 'src/old-name.ts',
                        unified_diff: '@@\n-old\n+new',
                        modify: { old_content: 'old', new_content: 'new' },
                    }),
                },
            }),
        );
    });

    it('normalizes Codex patch permission change arrays into canonical changes maps', () => {
        const normalized = normalizeToolInputForRendering({
            toolName: 'CodexPatch',
            canonicalToolName: 'Patch',
            input: {
                changes: [
                    {
                        path: '/tmp/happier-codex-qa-1774030477/NOTES.md',
                        kind: { type: 'update', move_path: null },
                        diff: [
                            '@@ -2 +2,2 @@',
                            '-old line',
                            '+old line',
                            '+new line',
                        ].join('\n'),
                    },
                ],
            },
        });

        expect(normalized).toEqual(
            expect.objectContaining({
                changes: {
                    '/tmp/happier-codex-qa-1774030477/NOTES.md': expect.objectContaining({
                        type: 'update',
                        unified_diff: '@@ -2 +2,2 @@\n-old line\n+old line\n+new line',
                        modify: {
                            old_content: 'old line',
                            new_content: 'old line\nnew line',
                        },
                    }),
                },
            }),
        );
    });
});
