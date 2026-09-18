import { storage } from '@/sync/domains/state/storage';
import { resolveServerIdForSessionIdFromLocalState } from '@/sync/domains/session/resolveSessionAddressFromLocalState';

export {
    resolveServerIdForSessionIdFromLocalState,
} from '@/sync/domains/session/resolveSessionAddressFromLocalState';

export function resolveServerIdForSessionIdFromLocalCache(sessionId: string): string | null {
    return resolveServerIdForSessionIdFromLocalState(storage.getState(), sessionId);
}
