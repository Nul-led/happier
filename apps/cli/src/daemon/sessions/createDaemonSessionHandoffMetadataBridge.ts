import type { SessionHandoffLocalMetadataSource } from '@/session/handoff/metadata/runtimeLocalSessionHandoffMetadata';

import { createLoadLocalSessionMetadataForHandoff, createResolveHostedSessionWorkingDirectory } from './createLoadLocalSessionMetadataForHandoff';
import type { TrackedSession } from '../types';

export type DaemonSessionHandoffMetadataBridge = Readonly<{
  loadLocalSessionMetadataForHandoff: (sessionId: string) => Promise<SessionHandoffLocalMetadataSource | null>;
  resolveHostedSessionWorkingDirectory: (sessionId: string) => Promise<string | null>;
}>;

export function createDaemonSessionHandoffMetadataBridge(params: Readonly<{
  pidToTrackedSession: Map<number, TrackedSession>;
  getMachineId: () => string;
}>): DaemonSessionHandoffMetadataBridge {
  return {
    resolveHostedSessionWorkingDirectory: createResolveHostedSessionWorkingDirectory(params),
    loadLocalSessionMetadataForHandoff: createLoadLocalSessionMetadataForHandoff({
      pidToTrackedSession: params.pidToTrackedSession,
      getMachineId: params.getMachineId,
    }),
  };
}
