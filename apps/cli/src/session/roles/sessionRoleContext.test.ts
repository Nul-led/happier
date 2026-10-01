import { describe, expect, it } from 'vitest';
import { BUILT_IN_ROLES_V1, buildBackendTargetKeyV2, renderSessionRoleBlockV1, type SessionMetadata, type V2SessionByIdResponse } from '@happier-dev/protocol';
import { createSessionRoleContext } from './sessionRoleContext';

const defaultEngine = { agentTargetKey: buildBackendTargetKeyV2({ kind: 'backend', backendId: 'codex' }) };

describe('session role prompt-plan context', () => {
  it('resolves live source and session fields for the canonical Session prompt plan', async () => {
    let metadata: SessionMetadata = { work: { sessionRolesV1: { roleId: 'builder', overrides: {}, sessionRoles: {}, notes: '' } } };
    const owner = createSessionRoleContext({ readMetadata: () => metadata,
      readOrganization: async () => ({}),
      readRoleSources: async () => [{ roleId: 'builder', role: BUILT_IN_ROLES_V1.builder, shared: false, viewOnly: false, migratedFromV0_2: false }],
      readSettings: () => null, readDefaultEngine: () => defaultEngine,
    });
    const first = await owner.resolvePromptContext();
    expect(renderSessionRoleBlockV1(first!)).toContain(BUILT_IN_ROLES_V1.builder.instructions);
    metadata = { work: { sessionRolesV1: { roleId: 'builder', overrides: { builder: { roleId: 'builder', instructionsOverride: 'CHANGED_ROLE' } }, sessionRoles: {}, notes: 'CURRENT_NOTES' } } };
    expect(renderSessionRoleBlockV1((await owner.resolvePromptContext())!)).toContain('CHANGED_ROLE');
  });

  it('renders a live worker boundary without a selected role and leaves frozen step roles to step input', async () => {
    let metadata: SessionMetadata = {};
    let organization: Pick<V2SessionByIdResponse['session'], 'reportsTo' | 'origin'> = { reportsTo: { sessionId: 'lead' } };
    const owner = createSessionRoleContext({ readMetadata: () => metadata, readOrganization: async () => organization,
      readRoleSources: async () => [], readSettings: () => null, readDefaultEngine: () => defaultEngine });
    expect(renderSessionRoleBlockV1((await owner.resolvePromptContext())!)).toContain('lead_session_id="lead"');
    metadata = { work: { sessionRolesV1: { inheritedFrom: 'lead', overrides: {}, sessionRoles: {}, notes: 'TASK_BOUNDARY', memoryDocRef: { kind: 'doc', artifactId: 'memory' } } } };
    expect(renderSessionRoleBlockV1((await owner.resolvePromptContext())!)).toContain('TASK_BOUNDARY');
    expect(renderSessionRoleBlockV1((await owner.resolvePromptContext())!)).toContain('memory');
    organization = { ...organization, origin: { kind: 'run_step' } };
    expect(renderSessionRoleBlockV1((await owner.resolvePromptContext())!)).toBe('');
    organization = {};
    const detached = renderSessionRoleBlockV1((await owner.resolvePromptContext())!);
    expect(detached).not.toContain('lead_session_id');
    expect(detached).not.toContain('memory');
    expect(detached).toContain('TASK_BOUNDARY');
  });

  it('does not use an inherited snapshot as a live relation when its Home projection is unavailable', async () => {
    const owner = createSessionRoleContext({ readMetadata: () => ({ work: { sessionRolesV1: {
      inheritedFrom: 'old-lead', overrides: {}, sessionRoles: {}, notes: 'old boundary',
    } } }), readOrganization: async () => { throw new Error('home unavailable'); },
      readRoleSources: async () => [], readSettings: () => null, readDefaultEngine: () => defaultEngine });
    await expect(owner.resolvePromptContext()).rejects.toThrow('home unavailable');
  });
});
