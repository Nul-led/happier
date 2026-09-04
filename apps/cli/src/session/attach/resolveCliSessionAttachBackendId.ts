import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';
import {
  readAcpConfiguredBackendV1FromMetadata,
  readLegacyConfiguredAcpBackendId,
} from '@happier-dev/protocol';

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveCliSessionAttachBackendId(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  return readAcpConfiguredBackendV1FromMetadata(metadata)?.backendId
    ?? readLegacyConfiguredAcpBackendId(metadata.flavor)
    ?? resolveAgentIdFromSessionMetadata(metadata);
}
