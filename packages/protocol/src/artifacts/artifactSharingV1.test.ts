import { describe, expect, it } from 'vitest';

import {
  filterArtifactSharingResourcesByKindV1,
  workflowDefinitionArtifactSharingAdapterV1,
} from './artifactSharingV1.js';

const artifact = {
  artifactId: 'definition-1', ownerAccountId: 'owner', access: 'owner' as const,
  header: {
    kind: 'workflow-definition.v1', definitionId: 'definition-1',
    revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Review' },
  },
};
describe('Document sharing kind owner', () => {
  it('filters only supplied grant-reachable opened headers by their validated kind', () => {
    const resources = [artifact, { ...artifact, artifactId: 'role-1', header: { kind: 'role.v1' } },
      { ...artifact, header: { ...artifact.header, definitionId: 'other' } },
      { ...artifact, revision: { headerVersion: 2, bodyVersion: 1 } }];
    expect(filterArtifactSharingResourcesByKindV1(resources, workflowDefinitionArtifactSharingAdapterV1)).toEqual([artifact]);
  });
});
