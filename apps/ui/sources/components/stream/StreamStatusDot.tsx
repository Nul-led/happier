import * as React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { StatusDot } from '@/components/ui/status/StatusDot';
import type { LiveStreamPlayerPhase } from '@/sync/domains/machines/peer/mediation/stream/player';

/**
 * Stream-domain status indicator: maps a semantic stream `variant` to its themed state token and
 * draws the canonical `StatusDot` with its soft ring (the one halo composition). It never pulses — a
 * playing stream already moves, and a stalled or failed one must not read as live (H-UX F-10/F-11).
 * The dot always sits beside its status in words, so it carries no label of its own.
 */

export type StreamStatusDotVariant = 'live' | 'stale' | 'error' | 'idle';

type StateTokenKey = 'success' | 'warning' | 'danger' | 'neutral';

const VARIANT_TO_STATE_TOKEN: Readonly<Record<StreamStatusDotVariant, StateTokenKey>> = {
    live: 'success',
    stale: 'warning',
    error: 'danger',
    idle: 'neutral',
};

/**
 * Canonical mapping from a live-stream phase (+ optional reason code) to the
 * status-dot variant. Single owner so the player overlay and the device-preview
 * header share one set of dot semantics (live / stale / error / idle).
 */
export function resolveStreamStatusDotVariant(
    phase: LiveStreamPlayerPhase,
    reasonCode?: string,
): StreamStatusDotVariant {
    if (reasonCode === 'input_lease_expired' || reasonCode === 'permission_expired') return 'error';
    switch (phase) {
        case 'playing':
            return 'live';
        case 'degraded':
        case 'reconnecting':
            return 'stale';
        case 'error':
            return 'error';
        case 'opening':
        case 'stopped':
        case 'idle':
            return 'idle';
    }
}

export function StreamStatusDot(props: Readonly<{
    variant: StreamStatusDotVariant;
    size?: number;
    style?: StyleProp<ViewStyle>;
    testID?: string;
}>): React.ReactElement {
    const { theme } = useUnistyles();
    const token = theme.colors.state[VARIANT_TO_STATE_TOKEN[props.variant]];
    return (
        <View testID={props.testID} pointerEvents="none" style={props.style}>
            <StatusDot
                testID={props.testID ? `${props.testID}:dot` : undefined}
                color={token.foreground}
                halo={token.background}
                size={props.size ?? 8}
            />
        </View>
    );
}
