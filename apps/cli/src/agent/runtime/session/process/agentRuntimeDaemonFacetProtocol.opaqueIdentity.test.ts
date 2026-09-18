import { describe, expect, it } from 'vitest';

import { RunnerAgentDaemonExternalSessionRefV1Schema } from './agentRuntimeDaemonFacetProtocol';

// The Agent minted these bytes. The runner/daemon IPC seam transports the id
// back to that Agent, so a schema that re-canonicalizes it silently asks the
// Agent for a session it never issued.
const OPAQUE_REMOTE_SESSION_ID = '  provider\nses/AB+cd==  ';

describe('runner/daemon External Sessions IPC identity', () => {
  it('transports an opaque remote session id byte-exact through the session ref', () => {
    const parsed = RunnerAgentDaemonExternalSessionRefV1Schema.parse({
      agentId: 'acme.provider',
      remoteSessionId: OPAQUE_REMOTE_SESSION_ID,
      sourceId: 'acme-source',
    });

    expect(parsed.remoteSessionId).toBe(OPAQUE_REMOTE_SESSION_ID);
  });

  it('rejects a whitespace-only remote session id', () => {
    expect(RunnerAgentDaemonExternalSessionRefV1Schema.safeParse({
      agentId: 'acme.provider',
      remoteSessionId: '   \n  ',
      sourceId: 'acme-source',
    }).success).toBe(false);
  });

  it('keeps the Happier-owned source id canonicalized', () => {
    // `sourceId` names a plugin-declared contribution, not an Agent-minted
    // identity, so it keeps its existing canonicalization.
    expect(RunnerAgentDaemonExternalSessionRefV1Schema.parse({
      agentId: 'acme.provider',
      remoteSessionId: OPAQUE_REMOTE_SESSION_ID,
      sourceId: '  acme-source  ',
    }).sourceId).toBe('acme-source');
  });
});
