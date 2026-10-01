import * as React from 'react';

import { resolvePluginSurfaceStateAction } from '@/components/sessions/panes/PluginSurfaceFallback';
import { SurfaceStateCard, type SurfaceStateAction } from '@/components/ui/surfaces/SurfaceStateCard';
import { resolvePluginSurfaceStatePresentation } from '@/sync/domains/surfaces/copy';
import { t } from '@/text';

type PluginReactNativeUnavailableProps = Readonly<{
    diagnostics?: readonly string[];
    /** Retries only the caller's current ephemeral mount attempt. */
    onRetry?: () => void;
    /** Route-owned recovery callback; the shared presentation owner supplies its semantic label. */
    recoveryAction?: SurfaceStateAction;
    /** While retrying, the canonical card owns the pending affordance. */
    retrying?: boolean;
    /** Respects the selected surface's reduced-motion fact for the loading glyph. */
    animationEnabled?: boolean;
}>;

export function PluginReactNativeUnavailable(props: PluginReactNativeUnavailableProps): React.ReactElement {
    const diagnostics = [...new Set(
        (props.diagnostics ?? []).filter((diagnostic) => diagnostic.trim().length > 0),
    )];
    const pending = props.retrying === true;
    const presentation = resolvePluginSurfaceStatePresentation({
        state: pending
            ? 'loading'
            : props.onRetry
                ? 'failedRetry'
                : 'unavailable',
        reasonCode: diagnostics[0],
        ...(pending ? {} : { title: t('pluginReactNative.unavailable') }),
    });
    const card = presentation.card;
    if (!card) {
        throw new Error('plugin_react_native_unavailable_presentation_missing_card');
    }
    const action = pending
        ? undefined
        : resolvePluginSurfaceStateAction({
            recoveryAction: presentation.recoveryAction,
            onRetry: props.onRetry,
            manageAction: props.recoveryAction,
        });
    return (
        <SurfaceStateCard
            testID="plugin-rn-ui-unavailable"
            kind={card.kind}
            title={card.title}
            reason={card.reason}
            action={action}
            accessibilitySemantics={card.accessibilitySemantics}
            animationEnabled={props.animationEnabled}
            // The full diagnostic set stays reachable for QA via the testID
            // channel only — never in visible product copy (audit PLG-11).
            diagnosticCode={diagnostics.length > 0
                ? diagnostics.slice(0, 3).join('|')
                : presentation.diagnosticCode}
        />
    );
}
