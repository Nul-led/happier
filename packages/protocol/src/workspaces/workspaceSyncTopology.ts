import type { WorkspaceSyncRelationshipV1 } from '../sessions/control/handoff/workspaceSyncSchemas.js';
import type { WorkspaceRefV1 } from './workspaceRefV1.js';

export type WorkspaceSyncEndpointRole = 'alpha' | 'beta';

export type WorkspaceSyncRelationshipEndpointRoles = Readonly<{
  sourceEndpointRole: WorkspaceSyncEndpointRole;
  targetEndpointRole: WorkspaceSyncEndpointRole;
}>;

export type WorkspaceSyncTransferDirection = Readonly<{
  sourceEndpointRole: WorkspaceSyncEndpointRole;
  targetEndpointRole: WorkspaceSyncEndpointRole;
}>;

export type DerivedWorkspaceSyncSet = Readonly<{
  hubWorkspaceRefId: string;
  controllerMachineId: string;
  relationships: readonly WorkspaceSyncRelationshipV1[];
}>;

export type WorkspaceSyncTopologyIssue = Readonly<{
  code: 'missing_workspace_ref' | 'invalid_controller' | 'duplicate_endpoint_pair' | 'unsupported_component';
  relationshipIds: readonly string[];
  workspaceRefIds: readonly string[];
}>;

export type WorkspaceSyncTopology = Readonly<{
  sets: readonly DerivedWorkspaceSyncSet[];
  issues: readonly WorkspaceSyncTopologyIssue[];
}>;

export type WorkspaceSyncTransferRoute =
  | Readonly<{ ok: true; kind: 'same_workspace'; relationships: readonly [] }>
  | Readonly<{
      ok: true;
      kind: 'direct' | 'via_hub';
      hubWorkspaceRefId: string;
      controllerMachineId: string;
      relationships: readonly WorkspaceSyncRelationshipV1[];
    }>
  | Readonly<{
      ok: false;
      code: 'workspace_ref_not_ready' | 'route_not_found' | 'topology_invalid';
      workspaceRefId?: string;
    }>
  | Readonly<{
      ok: false;
      code: 'relationship_paused' | 'direction_mismatch';
      relationshipId: string;
    }>;

export function resolveWorkspaceSyncRelationshipEndpointRoles(input: Readonly<{
  mode: WorkspaceSyncRelationshipV1['mode'];
  controllerMachineId: string;
  alphaMachineId: string;
  betaMachineId: string;
}>): WorkspaceSyncRelationshipEndpointRoles | null {
  const controllerMachineId = input.controllerMachineId.trim();
  const alphaMachineId = input.alphaMachineId.trim();
  const betaMachineId = input.betaMachineId.trim();
  if (input.mode !== 'keep_both_in_sync') {
    return alphaMachineId === controllerMachineId
      ? { sourceEndpointRole: 'alpha', targetEndpointRole: 'beta' }
      : null;
  }
  // A same-Machine pair retains the established alpha-source convention.
  if (alphaMachineId === controllerMachineId) {
    return { sourceEndpointRole: 'alpha', targetEndpointRole: 'beta' };
  }
  if (betaMachineId === controllerMachineId) {
    return { sourceEndpointRole: 'beta', targetEndpointRole: 'alpha' };
  }
  return null;
}

export function resolveWorkspaceSyncRelationshipTransferDirection(input: Readonly<{
  relationship: WorkspaceSyncRelationshipV1;
  sourceWorkspaceRefId: string;
  targetWorkspaceRefId: string;
}>): WorkspaceSyncTransferDirection | null {
  const { relationship, sourceWorkspaceRefId, targetWorkspaceRefId } = input;
  if (sourceWorkspaceRefId === targetWorkspaceRefId) return null;
  const forward = sourceWorkspaceRefId === relationship.alphaWorkspaceRefId
    && targetWorkspaceRefId === relationship.betaWorkspaceRefId;
  if (forward) return { sourceEndpointRole: 'alpha', targetEndpointRole: 'beta' };
  const reverse = sourceWorkspaceRefId === relationship.betaWorkspaceRefId
    && targetWorkspaceRefId === relationship.alphaWorkspaceRefId;
  if (reverse && relationship.mode === 'keep_both_in_sync') {
    return { sourceEndpointRole: 'beta', targetEndpointRole: 'alpha' };
  }
  return null;
}

function componentRelationships(
  relationships: readonly WorkspaceSyncRelationshipV1[],
): readonly (readonly WorkspaceSyncRelationshipV1[])[] {
  const byRef = new Map<string, WorkspaceSyncRelationshipV1[]>();
  for (const relationship of relationships) {
    for (const refId of [relationship.alphaWorkspaceRefId, relationship.betaWorkspaceRefId]) {
      const entries = byRef.get(refId) ?? [];
      entries.push(relationship);
      byRef.set(refId, entries);
    }
  }
  const visited = new Set<string>();
  const components: WorkspaceSyncRelationshipV1[][] = [];
  for (const relationship of relationships) {
    if (visited.has(relationship.relationshipId)) continue;
    const component: WorkspaceSyncRelationshipV1[] = [];
    const pending = [relationship];
    visited.add(relationship.relationshipId);
    while (pending.length > 0) {
      const current = pending.shift()!;
      component.push(current);
      for (const refId of [current.alphaWorkspaceRefId, current.betaWorkspaceRefId]) {
        for (const adjacent of byRef.get(refId) ?? []) {
          if (visited.has(adjacent.relationshipId)) continue;
          visited.add(adjacent.relationshipId);
          pending.push(adjacent);
        }
      }
    }
    components.push(component);
  }
  return components;
}

export function deriveWorkspaceSyncTopology(input: Readonly<{
  workspaceRefs: readonly WorkspaceRefV1[];
  relationships: readonly WorkspaceSyncRelationshipV1[];
}>): WorkspaceSyncTopology {
  const refs = new Map(input.workspaceRefs.map((ref) => [ref.id, ref] as const));
  const issues: WorkspaceSyncTopologyIssue[] = [];
  const sets: DerivedWorkspaceSyncSet[] = [];
  const seenPairs = new Map<string, WorkspaceSyncRelationshipV1>();

  for (const relationship of input.relationships) {
    const missing = [relationship.alphaWorkspaceRefId, relationship.betaWorkspaceRefId]
      .filter((refId) => !refs.has(refId));
    if (missing.length > 0) continue;
    const pair = [relationship.alphaWorkspaceRefId, relationship.betaWorkspaceRefId].sort().join('\u0000');
    const previous = seenPairs.get(pair);
    if (previous) {
      issues.push({
        code: 'duplicate_endpoint_pair',
        relationshipIds: [previous.relationshipId, relationship.relationshipId],
        workspaceRefIds: [relationship.alphaWorkspaceRefId, relationship.betaWorkspaceRefId],
      });
    } else {
      seenPairs.set(pair, relationship);
    }
  }

  for (const component of componentRelationships(input.relationships)) {
    const relationshipIds = component.map(({ relationshipId }) => relationshipId);
    const workspaceRefIds = [...new Set(component.flatMap((relationship) => [
      relationship.alphaWorkspaceRefId,
      relationship.betaWorkspaceRefId,
    ]))];
    const missingWorkspaceRefIds = [...new Set(component.flatMap((relationship) => (
      [relationship.alphaWorkspaceRefId, relationship.betaWorkspaceRefId].filter((refId) => !refs.has(refId))
    )))];
    if (missingWorkspaceRefIds.length > 0) {
      issues.push({
        code: 'missing_workspace_ref',
        relationshipIds,
        workspaceRefIds: missingWorkspaceRefIds,
      });
      continue;
    }
    const resolved = component.map((relationship) => {
      const alpha = refs.get(relationship.alphaWorkspaceRefId);
      const beta = refs.get(relationship.betaWorkspaceRefId);
      const roles = resolveWorkspaceSyncRelationshipEndpointRoles({
        mode: relationship.mode,
        controllerMachineId: relationship.controllerMachineId,
        alphaMachineId: alpha!.machineId,
        betaMachineId: beta!.machineId,
      });
      return { relationship, roles };
    });
    const invalidControllers = resolved.filter(({ roles }) => roles === null);
    for (const { relationship } of invalidControllers) {
      issues.push({
        code: 'invalid_controller',
        relationshipIds,
        workspaceRefIds: [relationship.alphaWorkspaceRefId, relationship.betaWorkspaceRefId],
      });
    }
    if (invalidControllers.length > 0) continue;

    const hubs = new Set(resolved.map(({ relationship, roles }) => (
      roles!.sourceEndpointRole === 'alpha'
        ? relationship.alphaWorkspaceRefId
        : relationship.betaWorkspaceRefId
    )));
    const controllers = new Set(component.map(({ controllerMachineId }) => controllerMachineId));
    if (hubs.size !== 1 || controllers.size !== 1) {
      issues.push({ code: 'unsupported_component', relationshipIds, workspaceRefIds });
      continue;
    }
    const hubWorkspaceRefId = [...hubs][0]!;
    const spokes = resolved.map(({ relationship, roles }) => (
      roles!.targetEndpointRole === 'alpha'
        ? relationship.alphaWorkspaceRefId
        : relationship.betaWorkspaceRefId
    ));
    if (new Set(spokes).size !== spokes.length || spokes.includes(hubWorkspaceRefId)) {
      issues.push({ code: 'unsupported_component', relationshipIds, workspaceRefIds });
      continue;
    }
    sets.push({
      hubWorkspaceRefId,
      controllerMachineId: [...controllers][0]!,
      relationships: component,
    });
  }

  return { sets, issues };
}

function relationshipContainsRef(relationship: WorkspaceSyncRelationshipV1, workspaceRefId: string): boolean {
  return relationship.alphaWorkspaceRefId === workspaceRefId
    || relationship.betaWorkspaceRefId === workspaceRefId;
}

/**
 * Derives the only supported transfer route from the current pair/star
 * definitions. It never searches for an alternate route after selecting a
 * component, rewrites endpoint ids, or relaxes one-way direction.
 */
export function resolveWorkspaceSyncTransferRoute(input: Readonly<{
  workspaceRefs: readonly WorkspaceRefV1[];
  relationships: readonly WorkspaceSyncRelationshipV1[];
  sourceWorkspaceRefId: string;
  targetWorkspaceRefId: string;
}>): WorkspaceSyncTransferRoute {
  const sourceWorkspaceRefId = input.sourceWorkspaceRefId.trim();
  const targetWorkspaceRefId = input.targetWorkspaceRefId.trim();
  const refIds = new Set(input.workspaceRefs.map((ref) => ref.id));
  if (!refIds.has(sourceWorkspaceRefId)) {
    return { ok: false, code: 'workspace_ref_not_ready', workspaceRefId: sourceWorkspaceRefId };
  }
  if (!refIds.has(targetWorkspaceRefId)) {
    return { ok: false, code: 'workspace_ref_not_ready', workspaceRefId: targetWorkspaceRefId };
  }
  if (sourceWorkspaceRefId === targetWorkspaceRefId) {
    return { ok: true, kind: 'same_workspace', relationships: [] };
  }

  const topology = deriveWorkspaceSyncTopology({
    workspaceRefs: input.workspaceRefs,
    relationships: input.relationships,
  });
  const issue = topology.issues.find((candidate) => (
    candidate.workspaceRefIds.includes(sourceWorkspaceRefId)
    || candidate.workspaceRefIds.includes(targetWorkspaceRefId)
    || candidate.relationshipIds.some((relationshipId) => {
      const relationship = input.relationships.find((entry) => entry.relationshipId === relationshipId);
      return relationship !== undefined
        && relationshipContainsRef(relationship, sourceWorkspaceRefId)
        && relationshipContainsRef(relationship, targetWorkspaceRefId);
    })
  ));
  if (issue) return { ok: false, code: 'topology_invalid' };

  const set = topology.sets.find((candidate) => {
    const memberIds = new Set(candidate.relationships.flatMap((relationship) => [
      relationship.alphaWorkspaceRefId,
      relationship.betaWorkspaceRefId,
    ]));
    return memberIds.has(sourceWorkspaceRefId) && memberIds.has(targetWorkspaceRefId);
  });
  if (!set) return { ok: false, code: 'route_not_found' };

  const direct = set.relationships.find((relationship) => (
    relationshipContainsRef(relationship, sourceWorkspaceRefId)
    && relationshipContainsRef(relationship, targetWorkspaceRefId)
  ));
  const relationships = direct
    ? [direct]
    : [
        set.relationships.find((relationship) => (
          relationshipContainsRef(relationship, sourceWorkspaceRefId)
          && relationshipContainsRef(relationship, set.hubWorkspaceRefId)
        )),
        set.relationships.find((relationship) => (
          relationshipContainsRef(relationship, set.hubWorkspaceRefId)
          && relationshipContainsRef(relationship, targetWorkspaceRefId)
        )),
      ];
  if (relationships.some((relationship) => relationship === undefined)) {
    return { ok: false, code: 'route_not_found' };
  }
  const ordered = relationships as readonly WorkspaceSyncRelationshipV1[];
  let from = sourceWorkspaceRefId;
  for (const relationship of ordered) {
    if (!relationship.enabled) {
      return { ok: false, code: 'relationship_paused', relationshipId: relationship.relationshipId };
    }
    const to = relationshipContainsRef(relationship, targetWorkspaceRefId)
      ? targetWorkspaceRefId
      : set.hubWorkspaceRefId;
    if (!resolveWorkspaceSyncRelationshipTransferDirection({
      relationship,
      sourceWorkspaceRefId: from,
      targetWorkspaceRefId: to,
    })) {
      return { ok: false, code: 'direction_mismatch', relationshipId: relationship.relationshipId };
    }
    from = to;
  }
  return {
    ok: true,
    kind: direct ? 'direct' : 'via_hub',
    hubWorkspaceRefId: set.hubWorkspaceRefId,
    controllerMachineId: set.controllerMachineId,
    relationships: ordered,
  };
}
