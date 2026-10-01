import type { EmbedErrorCodeV1 } from '@happier-dev/protocol/embed';

import type { IconName } from '@/components/ui/icons/Icon';
import type { SurfaceStateKind } from '@/components/ui/surfaces/SurfaceStateCard';
import type { TranslationKeyNoParams } from '@/text';

export type EmbedErrorSurface = Readonly<{
    kind: SurfaceStateKind;
    titleKey: TranslationKeyNoParams;
    reasonKey: TranslationKeyNoParams | null;
    iconName: IconName;
    diagnosticCode: EmbedErrorCodeV1;
}>;

/**
 * One calm, centred state per refusal (plan 04 §6.1): what failed and the next step, with the code
 * behind Details. Refusals the viewer cannot tell apart share their copy. `credential_unavailable`
 * has no full-frame state: the last transcript stays, with the reconnecting banner.
 */
export function resolveEmbedErrorSurface(code: EmbedErrorCodeV1): EmbedErrorSurface | null {
    switch (code) {
        case 'credential_unavailable':
            return null;
        case 'origin_not_allowed':
            return { kind: 'denied', titleKey: 'embed.errors.originNotAllowed', reasonKey: 'embed.errors.originNotAllowedReason', iconName: 'globe', diagnosticCode: code };
        case 'credential_rejected':
        case 'session_not_found':
            return { kind: 'unavailable', titleKey: 'embed.errors.unavailable', reasonKey: null, iconName: 'chat-circle', diagnosticCode: code };
        case 'session_key_unavailable':
        case 'session_key_invalid':
        case 'session_key_not_transferable':
            return { kind: 'unavailable', titleKey: 'embed.errors.encrypted', reasonKey: null, iconName: 'lock', diagnosticCode: code };
        case 'create_not_granted':
            return { kind: 'denied', titleKey: 'embed.errors.createNotGranted', reasonKey: null, iconName: 'chat-circle', diagnosticCode: code };
        case 'unsupported_bridge_version':
            return { kind: 'error', titleKey: 'embed.errors.unsupportedVersion', reasonKey: 'embed.errors.unsupportedVersionReason', iconName: 'arrows-clockwise', diagnosticCode: code };
    }
}
