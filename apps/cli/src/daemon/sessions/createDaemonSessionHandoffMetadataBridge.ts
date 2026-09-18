import type { SessionHandoffLocalMetadataSource } from '@/session/handoff/metadata/runtimeLocalSessionHandoffMetadata';

import { createLoadLocalSessionMetadataForHandoff } from './createLoadLocalSessionMetadataForHandoff';
import type { TrackedSession } from '../types';

export type DaemonSessionHandoffMetadataBridge = Readonly<{
  loadLocalSessionMetadataForHandoff: (sessionId: string) => Promise<SessionHandoffLocalMetadataSource | null>;
}>;

export function createDaemonSessionHandoffMetadataBridge(params: Readonly<{
  pidToTrackedSession: Map<number, TrackedSession>;
  getMachineId: () => string;
}>): DaemonSessionHandoffMetadataBridge {
  return {
    loadLocalSessionMetadataForHandoff: createLoadLocalSessionMetadataForHandoff({
      pidToTrackedSession: params.pidToTrackedSession,
      getMachineId: params.getMachineId,
    }),
  };
}
