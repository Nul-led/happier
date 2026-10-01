import { HappierStatusDot, type HappierStatusDotProps } from '@happier-dev/plugin-ui/presentation';
import * as React from 'react';

import { useLayoutPresentationActive } from '@/components/ui/presentation/PluginSurfaceFocusEligibility';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { useHostActivelyViewed } from '@/utils/runtime/useHostActivelyViewed';

export type StatusDotProps = Omit<HappierStatusDotProps, 'reducedMotion'>;

/**
 * Happier core's status-dot adapter.
 *
 * The implementation is the shared presentation owner (UI-T27); this adapter
 * supplies the two host facts that decide whether the pulse may run, and only
 * on the pulsing path. Status dots mount by the hundred in virtualized lists,
 * so a preference read on the static path would make every row subscribe to a
 * value it cannot use.
 *
 * **Why the visibility gate lives here and not in the shared owner.**
 * `apps/ui/AGENTS.md` and `DESIGN.md` both require long-running status motion to
 * pause while hidden, backgrounded or offscreen. "Is anyone looking?" already has
 * one canonical answer — {@link useHostActivelyViewed} — which composes the
 * desktop window-presence fact that a bare `AppState` / `visibilityState` read
 * gets wrong: a Tauri webview can stay latched at `visible` behind a hidden
 * window. The portable presentation package cannot import that owner, and
 * restating the question inside it would create a second, wronger answer for the
 * host Happier actually ships. So the fact is injected through the existing
 * `animationEnabled` seam instead — no new prop, no second owner.
 */
export const StatusDot = React.memo((props: StatusDotProps) => (
    !props.isPulsing || props.animationEnabled === false
        ? <HappierStatusDot {...props} />
        : <MotionAwareStatusDot {...props} />
));

StatusDot.displayName = 'StatusDot';

function MotionAwareStatusDot(props: StatusDotProps) {
    const reducedMotion = useReducedMotionPreference();
    // One host watch for the whole app, not one subscription per dot.
    const hostActivelyViewed = useHostActivelyViewed();
    // A retained pane that is hidden (a closed right-sidebar tab) keeps its rows mounted; the
    // pulse is presentation, so it stops with the pane (F-PLAN-22) and resumes when it is shown.
    const presented = useLayoutPresentationActive();

    return (
        <HappierStatusDot
            {...props}
            animationEnabled={hostActivelyViewed && presented}
            reducedMotion={reducedMotion}
        />
    );
}
