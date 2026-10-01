import { describe, expect, it, vi } from 'vitest';
import { createArtifactAccessActionsV1 } from './artifactAccessActions.js';
import { workflowDefinitionArtifactSharingAdapterV1, type ArtifactSharingResourceV1 } from '../../artifacts/artifactSharingV1.js';

const input = { artifactId: 'workflow', principal: { kind: 'team' as const, teamId: 'team' }, accessLevel: 'edit' as const };
const resource = { artifactId: 'workflow', access: 'owner' as const,
  header: { kind: 'workflow-definition.v1', definitionId: 'workflow', revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Workflow' } },
  revision: { headerVersion: 1, bodyVersion: 1 } };
const response = { artifactId: 'workflow', ownerAccountId: 'owner', access: 'owner' as const, grants: [], changed: true };

describe('Artifact grant host owner', () => {
  it('validates the opened kind and owner/admin authority before a storage mutation, while allowing grantees to list', async () => {
    const write = vi.fn(async () => response);
    const { changed: _changed, ...listed } = response;
    let opened: ArtifactSharingResourceV1 = resource;
    const owner = createArtifactAccessActionsV1({ read: async () => opened, adapters: [workflowDefinitionArtifactSharingAdapterV1],
      transport: { list: async () => listed, set: write, remove: write } });
    await expect(owner({ actionId: 'artifact.access.grants.set', input })).resolves.toEqual(response);
    opened = { ...resource, access: 'admin' };
    await expect(owner({ actionId: 'artifact.access.grants.set', input })).resolves.toEqual(response);
    opened = { ...resource, access: 'edit' };
    await expect(owner({ actionId: 'artifact.access.grants.set', input })).rejects.toMatchObject({ code: 'artifact_access_forbidden' });
    await expect(owner({ actionId: 'artifact.access.grants.list', input: { artifactId: 'workflow' } })).resolves.toEqual(listed);
    opened = { ...resource, header: { ...resource.header, kind: 'unshareable' } };
    await expect(owner({ actionId: 'artifact.access.grants.set', input })).rejects.toMatchObject({ code: 'artifact_kind_not_shareable' });
    const { access: _access, ...predecessor } = resource;
    opened = predecessor;
    await expect(owner({ actionId: 'artifact.access.grants.set', input })).rejects.toMatchObject({ code: 'artifact_access_unavailable' });
    expect(write).toHaveBeenCalledTimes(2);
  });
});
