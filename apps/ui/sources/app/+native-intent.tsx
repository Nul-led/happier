import {
    buildAccountConnectRoutePath,
    parseAccountConnectDeepLink,
} from '@/auth/pairing/accountConnectUrl';
import {
    buildHomeQrInviteRestoreRoutePath,
    classifyLegacyPairingDeepLink,
} from '@/auth/pairing/pairingUrl';
import { LEGACY_PAIRING_UPDATE_REQUIRED_RESTORE_ROUTE_PATH } from '@/auth/pairing/legacyPairingUpdateRequiredRoute';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
    if (classifyLegacyPairingDeepLink(path)) {
        return LEGACY_PAIRING_UPDATE_REQUIRED_RESTORE_ROUTE_PATH;
    }

    const restorePath = buildHomeQrInviteRestoreRoutePath(path, 'enter_home');
    if (restorePath) return restorePath;

    const accountConnect = parseAccountConnectDeepLink(path);
    if (!accountConnect) return path;

    return buildAccountConnectRoutePath(accountConnect);
}
