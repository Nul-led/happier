import { countConnectedAccountsNeedingSignIn } from '@/sync/domains/connectedServices/countConnectedAccountsNeedingSignIn';
import { getStorage } from '@/sync/domains/state/storageStore';

/**
 * The Usage rail badge's summary projection: a number, so the always-mounted rail re-renders only
 * when the count changes, never on other profile updates.
 */
export function useConnectedAccountsNeedingSignInCount(): number {
    return getStorage()((state) => countConnectedAccountsNeedingSignIn(state.profile));
}
