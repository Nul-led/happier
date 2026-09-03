import { parseAccountConnectDeepLink } from '@/auth/pairing/accountConnectUrl';
import { classifyLegacyPairingDeepLink, parseHomeQrInviteDeepLink } from '@/auth/pairing/pairingUrl';
import { normalizeServerUrl } from '@/sync/domains/server/activeServerSwitch';

export type ParsedOnboardingScanPayload =
    | Readonly<{ kind: 'home_qr_invite'; rawLink: string }>
    | Readonly<{ kind: 'legacy_pairing_update_required' }>
    | Readonly<{ kind: 'account_connect'; publicKeyB64Url: string }>
    | Readonly<{ kind: 'relay_url'; serverUrl: string }>
    | Readonly<{ kind: 'unknown' }>;

function isLikelyRelayUrlCandidate(raw: string): boolean {
    return raw.includes('://') || raw.startsWith('localhost') || raw.startsWith('[') || /[.:]/.test(raw);
}

export function parseOnboardingScanPayload(raw: string): ParsedOnboardingScanPayload {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return { kind: 'unknown' };

    if (parseHomeQrInviteDeepLink(trimmed)) {
        return { kind: 'home_qr_invite', rawLink: trimmed };
    }

    if (classifyLegacyPairingDeepLink(trimmed)) {
        return { kind: 'legacy_pairing_update_required' };
    }

    const accountConnect = parseAccountConnectDeepLink(trimmed);
    if (accountConnect) {
        return {
            kind: 'account_connect',
            publicKeyB64Url: accountConnect.publicKeyB64Url,
        };
    }

    if (isLikelyRelayUrlCandidate(trimmed)) {
        const serverUrl = normalizeServerUrl(trimmed);
        if (serverUrl) {
            return {
                kind: 'relay_url',
                serverUrl,
            };
        }
    }

    return { kind: 'unknown' };
}
