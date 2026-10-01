import * as React from 'react';
import { View } from 'react-native';
import type { EmbedErrorCodeV1 } from '@happier-dev/protocol/embed';

import { EmbedErrorState, EmbedNothingToShowState, EmbedReconnectingBanner } from './EmbedStateSurface';

/**
 * What the embedded frame shows when the runtime is not simply ready (plan 04 §6.1): nothing while
 * loading (the host's placeholder covers the frame until `ready`), the reconnecting line over the
 * retained transcript for `credential_unavailable`, and one calm refusal state for everything else.
 */
export function EmbedRuntimeStateSurface(props: Readonly<{
    phase: 'loading' | 'ready' | 'error';
    error?: EmbedErrorCodeV1;
    onRetry?: () => void;
    /** A session is still displayed underneath (its last transcript stays). */
    retained?: boolean;
}>): React.ReactElement | null {
    if (props.phase !== 'error') return null;
    const error = props.error ?? 'credential_unavailable';
    if (error === 'credential_unavailable') {
        return (
            <View style={props.retained ? { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1, padding: 8 } : { flex: 1, justifyContent: 'flex-end', padding: 8 }}>
                <EmbedReconnectingBanner onRetry={() => props.onRetry?.()} busy={false} />
            </View>
        );
    }
    return (
        <View style={{ flex: 1, justifyContent: 'center' }}>
            {/* Opened without a chat where new chats are off: nothing to show, and no composer. */}
            {error === 'create_not_granted' ? <EmbedNothingToShowState /> : <EmbedErrorState code={error} />}
        </View>
    );
}
