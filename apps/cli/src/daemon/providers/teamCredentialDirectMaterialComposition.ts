import type { TeamCredentialDirectMaterialClient } from '@/daemon/connectedServices/directMaterial/teamCredentialDirectMaterialClient';
import type { SessionTeamCredentialDirectOpen } from '@/providers/broker/sessionTeamCredentialProviderBinding';

/**
 * Adapts the binding owner's already-resolved consumer to the direct-material
 * protocol. The daemon contributes only the actual worker Machine required by
 * an Execution Run; it does not decide whether the consumer is a Session or a
 * Run.
 */
export function createDaemonTeamCredentialDirectMaterialOpen(input: Readonly<{
  clientOpen: TeamCredentialDirectMaterialClient['open'];
  workerMachineId: string;
  signal: AbortSignal;
}>): SessionTeamCredentialDirectOpen {
  return async (request) => await input.clientOpen({
    teamId: request.teamId,
    resourceId: request.resourceId,
    consumer: request.consumer.kind === 'execution_run'
      ? {
          kind: 'execution_run',
          executionRunId: request.consumer.executionRunId,
          workerMachineId: input.workerMachineId,
        }
      : {
          kind: 'session',
          sessionId: request.consumer.sessionId,
        },
    slot: { kind: 'provider_model' },
    sourceMemberKey: request.sourceMemberKey,
    signal: input.signal,
  });
}
