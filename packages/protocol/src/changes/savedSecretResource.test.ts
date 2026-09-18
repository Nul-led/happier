import { describe, expect, it } from 'vitest';

import { ChangeEntrySchema, ChangeKindSchema } from './index.js';

describe('savedSecretResource AccountChange kind', () => {
  it('is a canonical bounded change kind distinct from Session share changes', () => {
    expect(ChangeKindSchema.parse('savedSecretResource')).toBe('savedSecretResource');
    expect(ChangeKindSchema.parse('share')).toBe('share');
  });
});
