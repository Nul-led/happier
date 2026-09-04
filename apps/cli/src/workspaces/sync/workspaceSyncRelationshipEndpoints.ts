import type { WorkspaceSyncRelationshipV1 } from './workspaceSyncTypes';

export type WorkspaceSyncRelationshipEndpointRoles = Readonly<{
  /** The endpoint this relationship bootstraps and materializes into. */
  targetEndpointRole: 'alpha' | 'beta';
  /** The endpoint whose bytes seed the target. */
  sourceEndpointRole: 'alpha' | 'beta';
}>;

/**
 * The single rule for which endpoint of a relationship is bootstrapped and
 * which one seeds it. A one-way relationship always flows alpha → beta and its
 * controller must own alpha. A two-way relationship bootstraps the endpoint the
 * controller does not host, and defaults to beta when the controller hosts
 * both. Returns `null` for a definition whose controller owns no endpoint, so
 * the caller can raise its own typed error rather than guessing a direction.
 */
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
      ? { targetEndpointRole: 'beta', sourceEndpointRole: 'alpha' }
      : null;
  }
  if (alphaMachineId === controllerMachineId) {
    return { targetEndpointRole: 'beta', sourceEndpointRole: 'alpha' };
  }
  if (betaMachineId === controllerMachineId) {
    return { targetEndpointRole: 'alpha', sourceEndpointRole: 'beta' };
  }
  return null;
}
