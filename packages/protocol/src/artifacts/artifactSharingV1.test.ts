import { describe, expect, it } from 'vitest';

import {
  filterArtifactSharingResourcesByKindV1,
  workflowDefinitionArtifactSharingAdapterV1,
  getArtifactUseTargetV1,
  artifactKindRequiresTextBodyV1,
} from './artifactSharingV1.js';

const artifact = {
  artifactId: 'definition-1', ownerAccountId: 'owner', access: 'owner' as const,
  header: {
    kind: 'workflow-definition.v1', definitionId: 'definition-1',
    revision: { headerVersion: 1, bodyVersion: 1 }, metadata: { title: 'Review' },
  },
};
describe('Document sharing kind owner', () => {
  it('routes ordinary documents and specialized text kinds through their canonical policies', () => {
    expect(getArtifactUseTargetV1({ artifactId: 'doc', header: {} }).kind).toBe('open');
    expect(getArtifactUseTargetV1({ artifactId: 'doc', header: { kind: 'prompt_doc.v2' } }).kind).toBe('prompt_doc');
    expect(getArtifactUseTargetV1({ artifactId: 'bundle', header: { kind: 'prompt_bundle.v2' } }).kind).toBe('prompt_bundle');
    expect(artifactKindRequiresTextBodyV1('approval_request.v1')).toBe(true);
    expect(artifactKindRequiresTextBodyV1('target_action_approval.v1')).toBe(true);
    expect(artifactKindRequiresTextBodyV1('execution_run_host_action_approval.v1')).toBe(true);
    expect(artifactKindRequiresTextBodyV1('published.v1')).toBe(false);
  });
  it('filters only supplied grant-reachable opened headers by their validated kind', () => {
    const resources = [artifact, { ...artifact, artifactId: 'role-1', header: { kind: 'role.v1' } },
      { ...artifact, header: { ...artifact.header, definitionId: 'other' } },
      { ...artifact, revision: { headerVersion: 2, bodyVersion: 1 } }];
    expect(filterArtifactSharingResourcesByKindV1(resources, workflowDefinitionArtifactSharingAdapterV1)).toEqual([artifact]);
  });
});
