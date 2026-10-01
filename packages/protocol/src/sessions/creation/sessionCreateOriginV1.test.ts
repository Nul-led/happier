import { describe, expect, it } from 'vitest';

import { SessionCreateOriginFieldsV1Schema } from './sessionCreateOriginV1.js';

describe('authenticated host Session creation facts', () => {
  it('accepts originless predecessor creation and exact current origin arms', () => {
    expect(SessionCreateOriginFieldsV1Schema.parse({})).toEqual({});
    for (const fields of [
      { originKind: 'none', workDepth: 0 },
      { originKind: 'session', originSessionId: 'session-1', workDepth: 37 },
      { originKind: 'execution_run', originSessionId: 'host-session', workDepth: 37 },
      { originKind: 'run_step', originRunId: 'workflow-run', workDepth: 37 },
    ]) {
      expect(SessionCreateOriginFieldsV1Schema.parse(fields)).toEqual(fields);
    }
  });

  it('refuses inconsistent identities, unknown authority and unpersistable depths', () => {
    for (const fields of [
      { originKind: 'none', originSessionId: 'session-1' },
      { originKind: 'session' },
      { originKind: 'execution_run', originRunId: 'local-run' },
      { originKind: 'run_step' },
      { originKind: 'session', originSessionId: 'session-1', originRunId: 'run-1' },
      { originKind: 'none', causeSessionId: 'session-1' },
      { workDepth: -1 },
      { workDepth: 1.5 },
      { workDepth: 2_147_483_648 },
    ]) {
      expect(SessionCreateOriginFieldsV1Schema.safeParse(fields).success).toBe(false);
    }
  });
});
