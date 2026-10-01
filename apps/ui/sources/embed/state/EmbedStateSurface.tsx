import * as React from 'react';
import type { EmbedErrorCodeV1 } from '@happier-dev/protocol/embed';

import { WarningActionBanner } from '@/components/sessions/shell/view/WarningActionBanner';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { t } from '@/text';

import { resolveEmbedErrorSurface } from './embedErrorSurface';

/**
 * The embedded chat's full-frame refusal (plan 04 §6.1): one calm, centred state per code, what
 * failed and the next step, with the code behind Details. Never a repair flow for encryption.
 */
export function EmbedErrorState(props: Readonly<{ code: EmbedErrorCodeV1 }>): React.ReactElement | null {
    const surface = resolveEmbedErrorSurface(props.code);
    if (!surface) return null;
    return (
        <SurfaceStateCard
            testID="embed-error-state"
            kind={surface.kind}
            iconName={surface.iconName}
            title={t(surface.titleKey)}
            {...(surface.reasonKey ? { reason: t(surface.reasonKey) } : {})}
            diagnosticCode={surface.diagnosticCode}
        />
    );
}

/** No chat to show and no new chats allowed: the calm empty state, with no composer. */
export function EmbedNothingToShowState(): React.ReactElement {
    return (
        <SurfaceStateCard
            testID="embed-nothing-to-show"
            kind="empty"
            iconName="chat-circle"
            title={t('embed.nothingToShow')}
            reason={t('embed.nothingToShowReason')}
        />
    );
}

/**
 * `credential_unavailable`: the last transcript stays, the composer is disabled, and this quiet line
 * sits in the composer stack with Retry (plan 04 §6.1, D9).
 */
export function EmbedReconnectingBanner(props: Readonly<{ onRetry: () => void; busy: boolean }>): React.ReactElement {
    return (
        <WarningActionBanner
            testID="embed-reconnecting"
            tone="neutral"
            iconName={null}
            title={t('embed.reconnecting')}
            actionLabel={t('common.retry')}
            actionTestID="embed-reconnecting-retry"
            actionBusy={props.busy}
            onActionPress={props.onRetry}
        />
    );
}
