import { describe, expect, it } from 'vitest';

import {
  areWorkspaceSyncEntryExpectationsEqual,
  computeWorkspaceSyncPolicyDigest,
  WorkspaceSyncConflictInspectActionInputV1Schema,
  WorkspaceSyncConflictInspectRpcRequestV1Schema,
  WorkspaceSyncConflictInspectRpcResultV1Schema,
  WorkspaceSyncConflictsListActionInputV1Schema,
  WorkspaceSyncRelationshipsListActionInputV1Schema,
  WorkspaceSyncRelationshipsListRpcRequestV1Schema,
  WorkspaceSyncRelationshipsListRpcResultV1Schema,
  WorkspaceSyncTargetEntryObserveV1Schema,
} from './workspaceSyncSchemas.js';

const fileExpectation = {
  kind: 'file' as const,
  digest: 'a'.repeat(40),
  executable: false,
  size: 12,
};

const contentPolicyInput = {
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: [] as readonly string[],
  extraIncludePatterns: [] as readonly string[],
};
const relationshipDefinition = {
  v: 1 as const,
  relationshipId: 'rel-ab',
  controllerMachineId: 'machine-a',
  alphaWorkspaceRefId: 'workspace-a',
  betaWorkspaceRefId: 'workspace-b',
  mode: 'keep_both_in_sync' as const,
  contentPolicy: {
    ...contentPolicyInput,
    extraIgnorePatterns: [...contentPolicyInput.extraIgnorePatterns],
    extraIncludePatterns: [...contentPolicyInput.extraIncludePatterns],
    policyDigest: computeWorkspaceSyncPolicyDigest(contentPolicyInput),
  },
  enabled: true,
  createdAtMs: 1,
  updatedAtMs: 2,
};

const status = {
  relationshipId: 'rel-ab',
  controllerMachineId: 'machine-a',
  state: 'watching' as const,
  alphaPath: '/repo/a',
  betaPath: '/repo/b',
  mode: 'keep_both_in_sync' as const,
  endpointStates: {
    alpha: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 },
    beta: { connected: true, scanned: true, scanProblemCount: 0, transitionProblemCount: 0 },
  },
  conflictCount: 0,
  lastCycleObservedAtMs: 7,
};

describe('workspace sync read Action contracts', () => {
  it('lists relationships on the exact controller with an optional set-member filter', () => {
    expect(WorkspaceSyncRelationshipsListRpcRequestV1Schema.parse({})).toEqual({});
    expect(
      WorkspaceSyncRelationshipsListRpcRequestV1Schema.parse({ workspaceRefId: 'workspace-a' }),
    ).toEqual({ workspaceRefId: 'workspace-a' });
    expect(
      WorkspaceSyncRelationshipsListRpcRequestV1Schema.safeParse({ controllerMachineId: 'machine-a' }).success,
    ).toBe(false);
    expect(
      WorkspaceSyncRelationshipsListRpcRequestV1Schema.safeParse({ workspaceRefId: '' }).success,
    ).toBe(false);

    expect(
      WorkspaceSyncRelationshipsListActionInputV1Schema.parse({ controllerMachineId: 'machine-a' }),
    ).toEqual({ controllerMachineId: 'machine-a' });
    expect(
      WorkspaceSyncRelationshipsListActionInputV1Schema.parse({ workspaceRefId: 'workspace-a' }),
    ).toEqual({ workspaceRefId: 'workspace-a' });
    expect(
      WorkspaceSyncRelationshipsListActionInputV1Schema.safeParse({}).success,
    ).toBe(false);
    expect(
      WorkspaceSyncRelationshipsListActionInputV1Schema.safeParse({
        controllerMachineId: 'machine-a',
        workspaceRefId: 'workspace-a',
        root: '/repo/a',
      }).success,
    ).toBe(false);
  });

  it('returns local definitions with current status and remote discovery without fabricated status', () => {
    const result = WorkspaceSyncRelationshipsListRpcResultV1Schema.parse({
      controllerMachineId: 'machine-a',
      sets: [{
        hubWorkspaceRefId: 'workspace-a',
        controllerMachineId: 'machine-a',
        relationshipIds: ['rel-ab'],
      }],
      relationships: [{ definition: relationshipDefinition, status }],
      remoteRelationships: [],
      membership: { workspaceRefId: 'workspace-a', found: true },
      discoveryAvailable: true,
    });
    expect(result.relationships).toHaveLength(1);
    expect(result.membership.found).toBe(true);
    expect(result.sets[0]).toMatchObject({ hubWorkspaceRefId: 'workspace-a' });
    // One relationship belongs to at most one derived set.
    expect(WorkspaceSyncRelationshipsListRpcResultV1Schema.safeParse({
      controllerMachineId: 'machine-a',
      sets: [
        { hubWorkspaceRefId: 'workspace-a', controllerMachineId: 'machine-a', relationshipIds: ['rel-ab'] },
        { hubWorkspaceRefId: 'workspace-b', controllerMachineId: 'machine-a', relationshipIds: ['rel-ab'] },
      ],
      relationships: [{ definition: relationshipDefinition, status }],
      remoteRelationships: [],
      membership: { workspaceRefId: 'workspace-a', found: true },
      discoveryAvailable: true,
    }).success).toBe(false);

    const missingStatus = WorkspaceSyncRelationshipsListRpcResultV1Schema.parse({
      controllerMachineId: 'machine-a',
      sets: [{
        hubWorkspaceRefId: 'workspace-a',
        controllerMachineId: 'machine-a',
        relationshipIds: ['rel-ab'],
      }],
      relationships: [{ definition: relationshipDefinition, status: null }],
      remoteRelationships: [{
        definition: { ...relationshipDefinition, relationshipId: 'rel-ac', controllerMachineId: 'machine-x' },
        controllerMachineId: 'machine-x',
      }],
      membership: { workspaceRefId: 'workspace-a', found: true },
      discoveryAvailable: true,
    });
    expect(missingStatus.relationships[0]?.status).toBeNull();
    expect(missingStatus.remoteRelationships).toHaveLength(1);

    // Missing is explicit: an empty membership never claims zero conflicts.
    const absent = WorkspaceSyncRelationshipsListRpcResultV1Schema.parse({
      controllerMachineId: 'machine-a',
      sets: [],
      relationships: [],
      remoteRelationships: [],
      membership: { workspaceRefId: 'workspace-unknown', found: false },
      discoveryAvailable: true,
    });
    expect(absent.membership.found).toBe(false);

    expect(
      WorkspaceSyncRelationshipsListRpcResultV1Schema.safeParse({
        controllerMachineId: 'machine-a',
        sets: [],
        relationships: [],
        remoteRelationships: [],
        membership: { workspaceRefId: null, found: null },
        discoveryAvailable: false,
      }).success,
    ).toBe(true);
  });

  it('asks one relationship conflict page at a time through the exact controller', () => {
    expect(
      WorkspaceSyncConflictsListActionInputV1Schema.parse({
        controllerMachineId: 'machine-a',
        relationshipId: 'rel-ab',
        limit: 50,
      }),
    ).toEqual({ controllerMachineId: 'machine-a', relationshipId: 'rel-ab', limit: 50 });
    expect(
      WorkspaceSyncConflictsListActionInputV1Schema.safeParse({ relationshipId: 'rel-ab', limit: 10 }).success,
    ).toBe(false);
    expect(
      WorkspaceSyncConflictsListActionInputV1Schema.safeParse({
        controllerMachineId: 'machine-a',
        relationshipId: 'rel-ab',
        limit: 10,
        aggregate: true,
      }).success,
    ).toBe(false);
  });

  it('inspects a set-member path with metadata by default and one bounded preview on request', () => {
    expect(
      WorkspaceSyncConflictInspectActionInputV1Schema.parse({
        controllerMachineId: 'machine-a',
        workspaceRefId: 'workspace-c',
        path: 'src/index.ts',
      }),
    ).toEqual({ controllerMachineId: 'machine-a', workspaceRefId: 'workspace-c', path: 'src/index.ts' });
    expect(
      WorkspaceSyncConflictInspectActionInputV1Schema.parse({
        workspaceRefId: 'workspace-c',
        path: 'src/index.ts',
        preview: { workspaceRefId: 'workspace-a', expected: fileExpectation },
      }),
    ).toEqual({
      workspaceRefId: 'workspace-c',
      path: 'src/index.ts',
      preview: { workspaceRefId: 'workspace-a', expected: fileExpectation },
    });
    // A preview selector without the reviewed expectation cannot authorize a preview read.
    expect(
      WorkspaceSyncConflictInspectActionInputV1Schema.safeParse({
        controllerMachineId: 'machine-a',
        workspaceRefId: 'workspace-c',
        path: 'src/index.ts',
        preview: { workspaceRefId: 'workspace-a' },
      }).success,
    ).toBe(false);
    // Caller roots and credentials are never part of the semantic input.
    expect(
      WorkspaceSyncConflictInspectActionInputV1Schema.safeParse({
        controllerMachineId: 'machine-a',
        workspaceRefId: 'workspace-c',
        path: '../escape.ts',
      }).success,
    ).toBe(false);
    expect(
      WorkspaceSyncConflictInspectActionInputV1Schema.safeParse({
        controllerMachineId: 'machine-a',
        workspaceRefId: 'workspace-c',
        path: 'src/index.ts',
        root: '/repo/a',
      }).success,
    ).toBe(false);
  });

  it('observes a target entry through relationship authority, never a caller root', () => {
    expect(
      WorkspaceSyncTargetEntryObserveV1Schema.parse({
        relationshipId: 'rel-ab',
        workspaceRefId: 'workspace-b',
        path: 'src/index.ts',
      }),
    ).toEqual({ relationshipId: 'rel-ab', workspaceRefId: 'workspace-b', path: 'src/index.ts' });
    expect(
      WorkspaceSyncTargetEntryObserveV1Schema.safeParse({
        relationshipId: 'rel-ab',
        workspaceRefId: 'workspace-b',
        path: 'src/index.ts',
        root: '/repo/b',
      }).success,
    ).toBe(false);
  });

  it('reports independent endpoint outcomes with explicit coverage, never a snapshot', () => {
    const result = WorkspaceSyncConflictInspectRpcResultV1Schema.parse({
      controllerMachineId: 'machine-a',
      hubWorkspaceRefId: 'workspace-a',
      path: 'src/index.ts',
      endpoints: [
        {
          workspaceRefId: 'workspace-a',
          outcome: 'observed',
          observation: fileExpectation,
          selections: [
            { relationshipId: 'rel-ab', side: 'alpha', decision: { status: 'unknown', reason: 'selection_unavailable' } },
          ],
        },
        {
          workspaceRefId: 'workspace-b',
          outcome: 'unreachable',
          selections: [
            { relationshipId: 'rel-ab', side: 'beta', decision: { status: 'unknown', reason: 'endpoint_unavailable' } },
          ],
        },
      ],
      versions: [{ endpointWorkspaceRefIds: ['workspace-a'], entry: fileExpectation }],
      coverage: { complete: false },
    });
    expect(result.coverage.complete).toBe(false);
    expect(result.versions).toHaveLength(1);
    // One failed endpoint never erases the observed one.
    expect(result.endpoints).toHaveLength(2);

    const withPreview = WorkspaceSyncConflictInspectRpcResultV1Schema.parse({
      controllerMachineId: 'machine-a',
      hubWorkspaceRefId: 'workspace-a',
      path: 'src/index.ts',
      endpoints: result.endpoints,
      versions: [{
        endpointWorkspaceRefIds: ['workspace-a'],
        entry: fileExpectation,
        preview: { workspaceRefId: 'workspace-a', preview: { status: 'missing' } },
      }],
      coverage: { complete: false },
    });
    expect(withPreview.versions).toHaveLength(1);
    // Exactly one bounded preview per response: never an N-way concatenation.
    const twoObserved = [
      {
        workspaceRefId: 'workspace-a',
        outcome: 'observed' as const,
        observation: fileExpectation,
        selections: [],
      },
      {
        workspaceRefId: 'workspace-b',
        outcome: 'observed' as const,
        observation: fileExpectation,
        selections: [],
      },
    ];
    expect(WorkspaceSyncConflictInspectRpcResultV1Schema.safeParse({
      controllerMachineId: 'machine-a',
      hubWorkspaceRefId: 'workspace-a',
      path: 'src/index.ts',
      endpoints: twoObserved,
      versions: [
        {
          endpointWorkspaceRefIds: ['workspace-a'],
          entry: fileExpectation,
          preview: { workspaceRefId: 'workspace-a', preview: { status: 'missing' } },
        },
        {
          endpointWorkspaceRefIds: ['workspace-b'],
          entry: fileExpectation,
          preview: { workspaceRefId: 'workspace-b', preview: { status: 'missing' } },
        },
      ],
      coverage: { complete: true },
    }).success).toBe(false);
  });

  it('binds every observed endpoint to exactly one matching version entry', () => {
    const endpoints = [
      {
        workspaceRefId: 'workspace-a',
        outcome: 'observed' as const,
        observation: fileExpectation,
        selections: [],
      },
      {
        workspaceRefId: 'workspace-b',
        outcome: 'unreachable' as const,
        selections: [],
      },
    ];
    const base = {
      controllerMachineId: 'machine-a',
      hubWorkspaceRefId: 'workspace-a',
      path: 'src/index.ts',
      endpoints,
      coverage: { complete: false },
    };
    // An observed endpoint with no version is incomplete, not clean.
    expect(WorkspaceSyncConflictInspectRpcResultV1Schema.safeParse({ ...base, versions: [] }).success).toBe(false);
    // An unobserved endpoint must never appear as a verified version.
    expect(WorkspaceSyncConflictInspectRpcResultV1Schema.safeParse({
      ...base,
      versions: [
        { endpointWorkspaceRefIds: ['workspace-a'], entry: fileExpectation },
        { endpointWorkspaceRefIds: ['workspace-b'], entry: fileExpectation },
      ],
    }).success).toBe(false);
    // The version entry must equal the actual observation, not a nearby one.
    expect(WorkspaceSyncConflictInspectRpcResultV1Schema.safeParse({
      ...base,
      versions: [{ endpointWorkspaceRefIds: ['workspace-a'], entry: { kind: 'missing' } }],
    }).success).toBe(false);

    // Size is reported metadata, not a version discriminator. The controller
    // groups files by digest and executable semantics, and the wire validator
    // must accept that same grouping.
    expect(WorkspaceSyncConflictInspectRpcResultV1Schema.safeParse({
      ...base,
      endpoints: [
        endpoints[0],
        { workspaceRefId: 'workspace-b', outcome: 'observed', observation: { ...fileExpectation, size: fileExpectation.size + 1 }, selections: [] },
      ],
      versions: [{ endpointWorkspaceRefIds: ['workspace-a', 'workspace-b'], entry: fileExpectation }],
      coverage: { complete: true },
    }).success).toBe(true);
  });

  it('groups by complete entry semantics, not display metadata or incomplete guesses', () => {
    expect(areWorkspaceSyncEntryExpectationsEqual(fileExpectation, { ...fileExpectation, size: 99 })).toBe(true);
    expect(areWorkspaceSyncEntryExpectationsEqual(fileExpectation, { ...fileExpectation, executable: true })).toBe(false);
    expect(areWorkspaceSyncEntryExpectationsEqual({ kind: 'symlink', target: '../raw/target' }, { kind: 'symlink', target: '../raw/target' })).toBe(true);
    expect(areWorkspaceSyncEntryExpectationsEqual({ kind: 'symlink', target: '../raw/target' }, { kind: 'symlink', target: 'raw/target' })).toBe(false);
    expect(areWorkspaceSyncEntryExpectationsEqual({ kind: 'directory', fingerprint: 'a'.repeat(64) }, { kind: 'directory', fingerprint: 'b'.repeat(64) })).toBe(false);
  });

  it('keeps the inspect RPC request scoped to one controller-local membership query', () => {
    expect(
      WorkspaceSyncConflictInspectRpcRequestV1Schema.parse({
        workspaceRefId: 'workspace-c',
        path: 'src/index.ts',
      }),
    ).toEqual({ workspaceRefId: 'workspace-c', path: 'src/index.ts' });
    expect(
      WorkspaceSyncConflictInspectRpcRequestV1Schema.parse({
        workspaceRefId: 'workspace-c',
        path: 'src/index.ts',
        preview: { workspaceRefId: 'workspace-a', expected: fileExpectation },
      }),
    ).toEqual({
      workspaceRefId: 'workspace-c',
      path: 'src/index.ts',
      preview: { workspaceRefId: 'workspace-a', expected: fileExpectation },
    });
    expect(
      WorkspaceSyncConflictInspectRpcRequestV1Schema.safeParse({
        workspaceRefId: 'workspace-c',
        path: 'src/index.ts',
        controllerMachineId: 'machine-a',
      }).success,
    ).toBe(false);
  });
});
