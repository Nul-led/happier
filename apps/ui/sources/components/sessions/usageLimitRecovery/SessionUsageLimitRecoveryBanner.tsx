import * as React from 'react';
import { WarningActionBanner } from '@/components/sessions/shell/view/WarningActionBanner';
import { nowServerMs } from '@/sync/runtime/time';
import { t } from '@/text';
import { useHostActivelyViewed as useViewed } from '@/utils/runtime/useHostActivelyViewed';

type Props = React.ComponentProps<typeof WarningActionBanner> & Readonly<{
    temporaryThrottle?: Readonly<{ nextCheckAtMs: number | null; attemptCount: number }>;
    surfaceFocused: boolean;
}>;

// The clock subscription belongs to this leaf; a tick never rerenders SessionView or its transcript.
export function SessionUsageLimitRecoveryBanner({ temporaryThrottle, surfaceFocused, ...props }: Props) {
    const viewed = useViewed();
    const deadline = temporaryThrottle?.nextCheckAtMs ?? null;
    const enabled = viewed && surfaceFocused && deadline !== null;
    const readSeconds = React.useCallback(() => deadline === null ? 0 : Math.max(0, Math.ceil((deadline - nowServerMs()) / 1_000)), [deadline]);
    const subscribe = React.useCallback((notify: () => void) => {
        if (!enabled || readSeconds() === 0) return () => {};
        const timer = setInterval(() => {
            notify();
            if (readSeconds() === 0) clearInterval(timer);
        }, 1_000);
        return () => clearInterval(timer);
    }, [enabled, readSeconds]);
    const seconds = React.useSyncExternalStore(subscribe, readSeconds, readSeconds);
    const attempt = (temporaryThrottle?.attemptCount ?? 0) + (deadline !== null ? 1 : 0);
    return <WarningActionBanner
        {...props}
        title={deadline !== null && seconds > 0
            ? t('session.usageLimitRecovery.overloadCountdown', { seconds, attempt })
            : props.title}
        body={temporaryThrottle && (deadline === null || seconds === 0) && attempt > 0
            ? `${props.body ?? ''} · ${t('session.usageLimitRecovery.overloadAttempt', { attempt })}`
            : props.body}
    />;
}
