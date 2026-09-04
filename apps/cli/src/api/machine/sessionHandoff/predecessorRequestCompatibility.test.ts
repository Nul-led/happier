import { describe, expect, it } from 'vitest';

import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { projectReleasedSessionHandoffRequestForMethod } from './predecessorCompatibility';

describe('released session handoff request compatibility', () => {
  it('freezes unversioned request schemas while leaving V3 method-discriminated', () => {
    const releasedStart = {
      sessionId: 'session-1',
      sourceMachineId: 'machine-1',
      targetMachineId: 'machine-2',
      sessionStorageMode: 'persisted',
      preferredTransportStrategies: ['server_routed_stream'],
      workspaceTransfer: {
        enabled: true,
        strategy: 'transfer_snapshot',
        conflictPolicy: 'replace_existing',
        includeIgnoredMode: 'exclude',
        ignoredIncludeGlobs: [],
      },
    };

    expect(projectReleasedSessionHandoffRequestForMethod(
      RPC_METHODS.DAEMON_SESSION_HANDOFF_START,
      releasedStart,
    )).toEqual({ accepted: true, input: releasedStart });
    expect(projectReleasedSessionHandoffRequestForMethod(
      RPC_METHODS.DAEMON_SESSION_HANDOFF_START,
      { ...releasedStart, currentOnly: true },
    )).toEqual({ accepted: false, response: { ok: false, errorCode: 'invalid_request' } });
    expect(projectReleasedSessionHandoffRequestForMethod(
      RPC_METHODS.DAEMON_SESSION_HANDOFF_START,
      {
        ...releasedStart,
        workspaceTransfer: { ...releasedStart.workspaceTransfer, currentOnly: true },
      },
    )).toEqual({ accepted: false, response: { ok: false, errorCode: 'invalid_request' } });

    const currentV3 = { ...releasedStart, currentOnly: true };
    expect(projectReleasedSessionHandoffRequestForMethod(
      RPC_METHODS.DAEMON_SESSION_HANDOFF_START_V3,
      currentV3,
    )).toEqual({ accepted: true, input: currentV3 });
  });

  // Provenance: immutable released tag cli-v0.2.11, published as
  // @happier-dev/cli@0.2.11 (npm provenance attested). The released delegated
  // UI path (0.2 `apps/ui/sources/sync/ops/delegatedSessionHandoff.ts`)
  // supplies `requestId`, optional `targetPath`, and optional
  // `targetSessionStorageMode` through DAEMON_SESSION_HANDOFF_START, and the
  // released schema declares those optional fields alongside
  // `workspaceTransfer` (0.2
  // `packages/protocol/src/sessionControl/handoff/handoffSchemas.ts`). The
  // strict released projection must accept that exact real shape so the
  // retired-workspace guard — not invalid_request — answers stale clients.
  it('accepts the real released cli-v0.2.11 delegated start shape so the retired workspace guard can answer', () => {
    const releasedDelegatedStart = {
      requestId: 'action-request-1',
      sessionId: 'session-1',
      sourceMachineId: 'machine-1',
      targetMachineId: 'machine-2',
      targetPath: '/home/guest/workspace',
      sessionStorageMode: 'persisted',
      targetSessionStorageMode: 'direct',
      preferredTransportStrategies: ['direct_peer', 'server_routed_stream'],
      workspaceTransfer: {
        enabled: true,
        strategy: 'sync_changes',
        conflictPolicy: 'replace_existing',
        includeIgnoredMode: 'exclude',
        ignoredIncludeGlobs: [],
      },
    };

    expect(projectReleasedSessionHandoffRequestForMethod(
      RPC_METHODS.DAEMON_SESSION_HANDOFF_START,
      releasedDelegatedStart,
    )).toEqual({ accepted: true, input: releasedDelegatedStart });
    // The retired field must survive projection untouched so the start
    // handler's workspace-sync guard still classifies it as update_required.
    const accepted = projectReleasedSessionHandoffRequestForMethod(
      RPC_METHODS.DAEMON_SESSION_HANDOFF_START,
      releasedDelegatedStart,
    );
    if (!accepted.accepted) throw new Error('released delegated start must be accepted');
    expect((accepted.input as Record<string, unknown>).workspaceTransfer).toBeDefined();

    // Released requests that merely carry the delegated fields, without any
    // retired workspace field, are unaffected and must not be rejected.
    const { workspaceTransfer: _retired, ...releasedStartWithoutWorkspace } = releasedDelegatedStart;
    expect(projectReleasedSessionHandoffRequestForMethod(
      RPC_METHODS.DAEMON_SESSION_HANDOFF_START,
      releasedStartWithoutWorkspace,
    )).toEqual({ accepted: true, input: releasedStartWithoutWorkspace });

    expect(projectReleasedSessionHandoffRequestForMethod(
      RPC_METHODS.DAEMON_SESSION_HANDOFF_START,
      {
        ...releasedDelegatedStart,
        workspaceTransfer: {
          ...releasedDelegatedStart.workspaceTransfer,
          conflictPolicy: 'create_sibling_copy',
        },
      },
    )).toEqual({ accepted: false, response: { ok: false, errorCode: 'invalid_request' } });
  });
});
