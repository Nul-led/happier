import { createServerFetchAtEndpoint } from '@/sync/http/client';
import { createSyncSocketTransport } from '@/sync/api/session/connection/createSyncSocketTransport';
(globalThis as Record<string, unknown>).__p = [createServerFetchAtEndpoint, createSyncSocketTransport];
