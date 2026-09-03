import { describe, expect, it } from 'vitest';

import { HostPrivatePluginInstallDecisionV1Schema } from './pluginInstallDecisionV1';

describe('HostPrivatePluginInstallDecisionV1Schema', () => {
  it('is absent from the protocol root public surface', async () => {
    const publicProtocol = await import('../index.js');
    expect(publicProtocol).not.toHaveProperty('HOST_PRIVATE_PLUGIN_INSTALL_DECISION_RPC_METHOD');
    expect(publicProtocol).not.toHaveProperty('HostPrivatePluginInstallDecisionV1Schema');
  }, 30_000);

  it('carries the pending change, the decision, and optional selections only', () => {
    expect(HostPrivatePluginInstallDecisionV1Schema.parse({
      v: 1,
      pendingChangeId: 'pending-1',
      decision: 'installAndTrust',
      optionalSelections: [{ accessId: 'workspace', selected: false }],
    })).toEqual({
      v: 1,
      pendingChangeId: 'pending-1',
      decision: 'installAndTrust',
      optionalSelections: [{ accessId: 'workspace', selected: false }],
    });
    expect(HostPrivatePluginInstallDecisionV1Schema.parse({
      v: 1,
      pendingChangeId: 'pending-2',
      decision: 'cancel',
    })).toEqual({
      v: 1,
      pendingChangeId: 'pending-2',
      decision: 'cancel',
    });
    // A development source root is a distinct authorization from installing a
    // package: it authorizes the daemon to evaluate executable code from a
    // local directory. The daemon change service already owns the decision
    // (`trustSourceRoot`); without it here the remote/UI surface can observe a
    // pending source-root review it can never decide.
    expect(HostPrivatePluginInstallDecisionV1Schema.parse({
      v: 1,
      pendingChangeId: 'pending-3',
      decision: 'trustSourceRoot',
    })).toEqual({
      v: 1,
      pendingChangeId: 'pending-3',
      decision: 'trustSourceRoot',
    });
  });

  /**
   * The caller never describes who it is or when it acted. The daemon
   * authenticates this RPC and matches the decision against its own current
   * pending change, so a self-asserted actor/interaction/timestamp is not
   * evidence of anything — it is only a field the caller can choose. Keeping
   * the request closed means a caller cannot re-introduce one.
   */
  it('rejects caller-asserted actor, interaction, or timing fields', () => {
    for (const invalid of [
      {
        v: 1,
        pendingChangeId: 'pending-1',
        decision: 'installAndTrust',
        actorEvidence: {
          kind: 'authenticatedLocalUser',
          interactionId: 'ui-interaction-1',
          occurredAtMs: 42,
        },
        optionalSelections: [],
      },
      {
        v: 1,
        pendingChangeId: 'pending-1',
        decision: 'trustSourceRoot',
        actorEvidence: {
          kind: 'authenticatedLocalUser',
          interactionId: 'ui-interaction-1',
          occurredAtMs: 42,
        },
      },
      {
        v: 1,
        pendingChangeId: 'pending-1',
        decision: 'installAndTrust',
        optionalSelections: [],
        occurredAtMs: 42,
      },
      {
        v: 1,
        pendingChangeId: 'pending-1',
        decision: 'cancel',
        actorEvidence: {
          kind: 'authenticatedLocalUser',
          interactionId: 'ui-interaction-1',
          occurredAtMs: 42,
        },
      },
    ]) {
      expect(HostPrivatePluginInstallDecisionV1Schema.safeParse(invalid).success).toBe(false);
    }
  });

  it('keeps optional selections bounded, unique, and exclusive to install-and-trust', () => {
    for (const invalid of [
      {
        v: 1,
        pendingChangeId: 'pending-1',
        decision: 'installAndTrust',
      },
      {
        v: 1,
        pendingChangeId: 'pending-1',
        decision: 'trustSourceRoot',
        optionalSelections: [],
      },
      {
        v: 1,
        pendingChangeId: 'pending-1',
        decision: 'installAndTrust',
        optionalSelections: [
          { accessId: 'workspace', selected: false },
          { accessId: 'workspace', selected: true },
        ],
      },
      {
        v: 1,
        pendingChangeId: 'pending-1',
        decision: 'cancel',
        optionalSelections: [],
      },
    ]) {
      expect(HostPrivatePluginInstallDecisionV1Schema.safeParse(invalid).success).toBe(false);
    }
  });
});
