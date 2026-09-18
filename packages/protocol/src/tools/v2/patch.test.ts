import { describe, expect, it } from 'vitest';

import { deriveCanonicalPatchFileDiffs } from './patch.js';

describe('deriveCanonicalPatchFileDiffs', () => {
  it('preserves operations, content, and move lineage from a raw apply_patch payload', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/updated.ts',
      '@@',
      '-before update',
      '+after update',
      '*** Add File: src/added.ts',
      '+added content',
      '*** Delete File: src/deleted.ts',
      '-deleted content',
      '*** Update File: src/old-name.ts',
      '*** Move to: src/new-name.ts',
      '@@',
      '-before rename',
      '+after rename',
      '*** End Patch',
    ].join('\n');

    expect(deriveCanonicalPatchFileDiffs({ patch })).toEqual([
      {
        filePath: 'src/updated.ts',
        changeKind: 'modified',
        unifiedDiff: '@@\n-before update\n+after update',
        oldText: 'before update',
        newText: 'after update',
      },
      {
        filePath: 'src/added.ts',
        changeKind: 'added',
        unifiedDiff: '+added content',
        oldText: '',
        newText: 'added content',
      },
      {
        filePath: 'src/deleted.ts',
        changeKind: 'deleted',
        unifiedDiff: '-deleted content',
        oldText: 'deleted content',
        newText: '',
      },
      {
        filePath: 'src/new-name.ts',
        previousFilePath: 'src/old-name.ts',
        changeKind: 'renamed',
        unifiedDiff: '@@\n-before rename\n+after rename',
        oldText: 'before rename',
        newText: 'after rename',
      },
    ]);
  });

  it('preserves empty-file additions', () => {
    expect(deriveCanonicalPatchFileDiffs({
      changes: {
        'empty.txt': {
          type: 'add',
          add: { content: '' },
        },
      },
    })).toEqual([
      {
        filePath: 'empty.txt',
        changeKind: 'added',
        oldText: '',
        newText: '',
      },
    ]);
  });

  it('preserves empty-file additions expressed with top-level content shorthand', () => {
    expect(deriveCanonicalPatchFileDiffs({
      changes: {
        'empty-top-level.txt': {
          type: 'add',
          content: '',
        },
      },
    })).toEqual([
      {
        filePath: 'empty-top-level.txt',
        changeKind: 'added',
        oldText: '',
        newText: '',
      },
    ]);
  });

  it('preserves updates that truncate a file to empty content', () => {
    expect(deriveCanonicalPatchFileDiffs({
      changes: {
        'truncate.txt': {
          type: 'update',
          modify: {
            old_content: 'before',
            new_content: '',
          },
        },
      },
    })).toEqual([
      {
        filePath: 'truncate.txt',
        changeKind: 'modified',
        oldText: 'before',
        newText: '',
      },
    ]);
  });

  it('preserves truncating updates expressed with top-level content shorthand', () => {
    expect(deriveCanonicalPatchFileDiffs({
      changes: {
        'truncate-top-level.txt': {
          type: 'update',
          old_content: 'before',
          new_content: '',
        },
      },
    })).toEqual([
      {
        filePath: 'truncate-top-level.txt',
        changeKind: 'modified',
        oldText: 'before',
        newText: '',
      },
    ]);
  });

  it('ignores malformed raw blocks without inventing a file attribution', () => {
    expect(deriveCanonicalPatchFileDiffs({
      patch: [
        '*** Begin Patch',
        '*** Update File:',
        '@@',
        '-before',
        '+after',
        '*** End Patch',
      ].join('\n'),
    })).toEqual([]);
  });
});
