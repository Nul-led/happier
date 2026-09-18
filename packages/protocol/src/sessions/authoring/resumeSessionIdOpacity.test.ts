import { describe, expect, it } from 'vitest';

import { AgentNativeResumeIdentityV1Schema } from '../../agents/nativeResumeIdentityV1.js';
import {
  SESSION_AUTHORING_FIELD_CATALOG,
  SessionAuthoringValueV1Schema,
  SyncedSessionAuthoringValueV1Schema,
  SyncedSessionAuthoringValueV2Schema,
} from './index.js';

/**
 * An Agent-issued resume id is opaque: Happier only ever hands it back to the
 * Agent that minted it. Whitespace, newlines, `/`, `+`, `=` and non-ASCII bytes
 * are the Agent's alphabet, not ours to canonicalize.
 */
const OPAQUE_RESUME_ID = ' provider\nsession ';
const OPAQUE_RESUME_ID_WITH_ENCODING_BYTES = ' a/b+c=d/é ';

describe('resume session id opacity', () => {
  it('preserves the exact Agent-issued bytes through the field catalog schema', () => {
    expect(SESSION_AUTHORING_FIELD_CATALOG.resumeSessionId.schema.parse(OPAQUE_RESUME_ID))
      .toBe(OPAQUE_RESUME_ID);
    expect(SESSION_AUTHORING_FIELD_CATALOG.resumeSessionId.schema.parse(
      OPAQUE_RESUME_ID_WITH_ENCODING_BYTES,
    )).toBe(OPAQUE_RESUME_ID_WITH_ENCODING_BYTES);
  });

  it('preserves the exact Agent-issued bytes through the current authoring value schemas', () => {
    expect(SessionAuthoringValueV1Schema.shape.resumeSessionId.parse(OPAQUE_RESUME_ID))
      .toBe(OPAQUE_RESUME_ID);
    expect(SyncedSessionAuthoringValueV2Schema.shape.resumeSessionId.parse(OPAQUE_RESUME_ID))
      .toBe(OPAQUE_RESUME_ID);
  });

  it('preserves the exact Agent-issued bytes through the released synchronized V1 projection', () => {
    expect(SyncedSessionAuthoringValueV1Schema.shape.resumeSessionId.parse(OPAQUE_RESUME_ID))
      .toBe(OPAQUE_RESUME_ID);
  });

  it('preserves the exact Agent-issued bytes through the native resume identity envelope', () => {
    expect(AgentNativeResumeIdentityV1Schema.parse({ v: 1, vendorResumeId: OPAQUE_RESUME_ID }))
      .toEqual({ v: 1, vendorResumeId: OPAQUE_RESUME_ID });
  });

  it('still rejects absent and blank-only resume ids at every owner', () => {
    for (const schema of [
      SESSION_AUTHORING_FIELD_CATALOG.resumeSessionId.schema,
      SessionAuthoringValueV1Schema.shape.resumeSessionId,
      SyncedSessionAuthoringValueV2Schema.shape.resumeSessionId,
      SyncedSessionAuthoringValueV1Schema.shape.resumeSessionId,
    ]) {
      expect(schema.safeParse('').success).toBe(false);
      expect(schema.safeParse('   ').success).toBe(false);
      expect(schema.safeParse(' \n\t ').success).toBe(false);
      expect(schema.safeParse(undefined).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(true);
    }

    expect(AgentNativeResumeIdentityV1Schema.safeParse({ v: 1, vendorResumeId: '   ' }).success)
      .toBe(false);
    expect(AgentNativeResumeIdentityV1Schema.safeParse({ v: 1, vendorResumeId: '' }).success)
      .toBe(false);
  });

  it('keeps the released vendor resume id length boundary measured on the preserved bytes', () => {
    const atBoundary = ` ${'x'.repeat(510)} `;
    const overBoundary = ` ${'x'.repeat(511)} `;

    expect(AgentNativeResumeIdentityV1Schema.safeParse({ v: 1, vendorResumeId: atBoundary }).success)
      .toBe(true);
    expect(AgentNativeResumeIdentityV1Schema.safeParse({ v: 1, vendorResumeId: overBoundary }).success)
      .toBe(false);
  });
});
