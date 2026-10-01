import { describe, expect, it } from 'vitest';
import {
  ScmCommitCreateRequestSchema,
  ScmOperationErrorCodeSchema,
  classifyScmOperationErrorCode,
  createScmCapabilities,
} from './index.js';
import { ScmBackendCommitCapabilitiesSchema } from './backendCapabilities.js';

describe('explicit commit modes', () => {
  it('preserves amend, independent sign-off and published-head acknowledgment', () => {
    const request = { message: 'Revise the commit', mode: 'amend', signOff: true, allowPublishedAmend: true };
    expect(ScmCommitCreateRequestSchema.parse(request)).toEqual(request);
    expect(ScmOperationErrorCodeSchema.safeParse('COMMIT_AMEND_PUBLISHED').success).toBe(true);
    expect(classifyScmOperationErrorCode('COMMIT_AMEND_PUBLISHED')).toBe('commit');
    expect(ScmCommitCreateRequestSchema.safeParse({ message: 'New commit', allowPublishedAmend: true }).success).toBe(false);
    expect(ScmCommitCreateRequestSchema.safeParse({ message: 'New commit', mode: 'automatic' }).success).toBe(false);
  });

  it('requires advertised commit-option support instead of inheriting ordinary commit support', () => {
    expect(createScmCapabilities()).toMatchObject({ writeCommitAmend: false, writeCommitSignOff: false });
    expect(ScmBackendCommitCapabilitiesSchema.parse({
      create: { support: 'supported' },
      amend: { support: 'supported' },
      signOff: { support: 'supported' },
    })).toMatchObject({ amend: { support: 'supported' }, signOff: { support: 'supported' } });
  });
});
