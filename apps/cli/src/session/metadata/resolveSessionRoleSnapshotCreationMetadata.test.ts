import { describe, expect, it } from 'vitest';
import { snapshotSessionRolesAtSpawnV1, type V2SessionByIdResponse } from '@happier-dev/protocol';

import { resolveSessionRoleSnapshotCreationMetadata } from './resolveSessionRoleSnapshotCreationMetadata';

const sessionRolesV1 = { ...snapshotSessionRolesAtSpawnV1({
  leadSessionId: 'lead', sameAccount: true, notes: 'Bounded task',
  memoryDocRef: { kind: 'doc', artifactId: 'private-memory' },
  roles: { builder: { roleId: 'builder', name: 'Builder', instructions: 'Complete resolved instructions',
    engine: { agentTargetKey: 'agent:codex', modelId: 'worker-model' }, runsAs: { kind: 'session' },
    workspaceWrites: 'allow', secondOpinion: 'off', enabled: true } },
}), roleId: 'builder' };
const metadata = { path: '/repo', work: { sessionRolesV1 } };

function ownerLead(): V2SessionByIdResponse['session'] {
  return { id: 'lead', seq: 0, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
    metadata: '{"v":1}', metadataVersion: 0, metadataLayoutVersion: 1,
    ownerMetadata: { t: 'plain', v: { v: 1 } }, share: null, dataEncryptionKey: null,
    agentState: null, agentStateVersion: 0 };
}

describe('role snapshot creation metadata', () => {
  it('retains a memory reference only when the target-authenticated Home projection proves lead ownership', async () => {
    const own = await resolveSessionRoleSnapshotCreationMetadata({ metadata, readLeadSession: async () => ownerLead() });
    expect(own).toEqual(metadata);

    const { ownerMetadata: _ownerMetadata, ...sharedLead } = ownerLead();
    const otherAccount = await resolveSessionRoleSnapshotCreationMetadata({ metadata,
      readLeadSession: async () => ({ ...sharedLead, share: { accessLevel: 'edit', canApprovePermissions: false } }),
    });
    expect(otherAccount).toEqual({ ...metadata, work: { sessionRolesV1: {
      roleId: 'builder', inheritedFrom: 'lead', overrides: {}, sessionRoles: sessionRolesV1.sessionRoles, notes: 'Bounded task',
    } } });
    expect(metadata.work.sessionRolesV1.memoryDocRef).toEqual({ kind: 'doc', artifactId: 'private-memory' });
  });

  it('keeps the complete roles and notes while dropping memory when ownership cannot be proved', async () => {
    for (const readLeadSession of [
      async () => null,
      async () => ({ ...ownerLead(), id: 'different-session' }),
      async () => { throw new Error('offline'); },
    ]) {
      const projected = await resolveSessionRoleSnapshotCreationMetadata({ metadata, readLeadSession });
      expect(projected).toMatchObject({ work: { sessionRolesV1: {
        roleId: 'builder', sessionRoles: sessionRolesV1.sessionRoles, notes: 'Bounded task',
      } } });
      expect(projected).not.toHaveProperty('work.sessionRolesV1.memoryDocRef');
    }
  });

  it('does not turn cancellation into a successful projection', async () => {
    const controller = new AbortController();
    const cancelled = new Error('cancelled');
    controller.abort(cancelled);
    await expect(resolveSessionRoleSnapshotCreationMetadata({ metadata, signal: controller.signal,
      readLeadSession: async () => ownerLead() })).rejects.toBe(cancelled);
  });
});
