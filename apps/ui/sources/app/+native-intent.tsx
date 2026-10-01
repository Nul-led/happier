import { classifyPairingLink } from '@/auth/pairing/classifyPairingLink';
import { buildAccountConnectRoutePath } from '@/auth/pairing/accountConnectUrl';
import { buildHomeQrInviteRestoreRoutePath } from '@/auth/pairing/pairingUrl';
import { LEGACY_PAIRING_UPDATE_REQUIRED_RESTORE_ROUTE_PATH } from '@/auth/pairing/legacyPairingUpdateRequiredRoute';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
    const link = classifyPairingLink(path);
    switch (link.kind) {
        case 'legacy_pairing':
            return LEGACY_PAIRING_UPDATE_REQUIRED_RESTORE_ROUTE_PATH;
        case 'home_qr_invite':
            return buildHomeQrInviteRestoreRoutePath(link.rawLink, 'enter_home') ?? path;
        case 'account_connect':
            return buildAccountConnectRoutePath(link);
        case 'terminal_connect':
        case 'team_join':
        case 'unknown':
            return path;
    }
}
