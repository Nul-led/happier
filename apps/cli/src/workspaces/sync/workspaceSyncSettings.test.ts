import { describe, expect, it } from 'vitest';
import { validateWorkspaceSyncRelationships } from './workspaceSyncSettings';
import { computeWorkspaceSyncPolicyDigest } from './workspaceSyncTypes';

const policy = { v: 1 as const, selection: 'all_files' as const, extraIgnorePatterns: [], extraIncludePatterns: [], policyDigest: '' };
policy.policyDigest = computeWorkspaceSyncPolicyDigest(policy);
const relationship = (id: string, alpha = 'a', beta = 'b') => ({ v: 1 as const, relationshipId: id, controllerMachineId: 'machine-a', alphaWorkspaceRefId: alpha, betaWorkspaceRefId: beta, mode: 'keep_synced' as const, contentPolicy: policy, enabled: true, createdAtMs: 1, updatedAtMs: 1 });

describe('workspace sync relationship settings', () => {
  it('accepts valid relationships without an arbitrary count limit', () => {
    const relationships = Array.from({ length: 33 }, (_, index) => relationship(`r${index + 1}`, `a${index + 1}`, `b${index + 1}`));
    expect(validateWorkspaceSyncRelationships(relationships)).toEqual(relationships);
  });
  it('rejects duplicate ids and endpoints', () => {
    expect(() => validateWorkspaceSyncRelationships([relationship('r1'), relationship('r1')])).toThrow(/relationshipId/);
    expect(() => validateWorkspaceSyncRelationships([relationship('r1', 'a', 'a')])).toThrow(/distinct/);
  });
  it('rejects invalid policy digests and oversized pattern lists', () => {
    expect(() => validateWorkspaceSyncRelationships([{ ...relationship('r1'), contentPolicy: { ...policy, policyDigest: 'bad' } }])).toThrow(/policyDigest/);
    const protocolMaximum = { ...policy, extraIgnorePatterns: Array.from({ length: 128 }, (_, index) => `${index}-${'x'.repeat(1018)}`), policyDigest: '' };
    protocolMaximum.policyDigest = computeWorkspaceSyncPolicyDigest(protocolMaximum);
    expect(validateWorkspaceSyncRelationships([{ ...relationship('r1'), contentPolicy: protocolMaximum }])).toHaveLength(1);
    const oversized = { ...policy, extraIgnorePatterns: Array.from({ length: 129 }, (_, index) => `${index}-x`), policyDigest: '' };
    oversized.policyDigest = computeWorkspaceSyncPolicyDigest(oversized);
    expect(() => validateWorkspaceSyncRelationships([{ ...relationship('r1'), contentPolicy: oversized }])).toThrow();
  });
  it('preserves ignore/include order because Git negation semantics are order-sensitive', () => {
    const ordered = { ...policy, extraIgnorePatterns: ['dist/**', '!dist/keep.txt'], policyDigest: '' };
    ordered.policyDigest = computeWorkspaceSyncPolicyDigest(ordered);
    expect(validateWorkspaceSyncRelationships([{ ...relationship('r1'), contentPolicy: ordered }])[0]?.contentPolicy.extraIgnorePatterns)
      .toEqual(['dist/**', '!dist/keep.txt']);
  });
  it('rejects unknown authority-bearing relationship and policy fields', () => {
    expect(() => validateWorkspaceSyncRelationships([{ ...relationship('r1'), futureAuthority: true }])).toThrow(/futureAuthority/i);
    expect(() => validateWorkspaceSyncRelationships([{ ...relationship('r1'), contentPolicy: { ...policy, fallbackSelection: 'all_files' } }])).toThrow(/fallbackSelection/i);
  });
});
