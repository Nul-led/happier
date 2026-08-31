import {
    buildAccountConnectRoutePath,
    parseAccountConnectDeepLink,
} from '@/auth/pairing/accountConnectUrl';
import { buildHomeQrInviteRestoreRoutePath } from '@/auth/pairing/pairingUrl';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
    const restorePath = buildHomeQrInviteRestoreRoutePath(path);
    if (restorePath) return restorePath;

    const accountConnect = parseAccountConnectDeepLink(path);
    if (!accountConnect) return path;

    return buildAccountConnectRoutePath(accountConnect);
}
