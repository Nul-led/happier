import * as React from 'react';
import { View } from 'react-native';
import { HappierLiveStreamPlayer, type HappierLiveStreamPlayerHost } from '@happier-dev/plugin-ui/presentation';
import { reduceLiveStreamPlayerDisplayState, type LiveStreamPlayerDisplayState } from '@/sync/domains/machines/peer/mediation/stream/player';
import { StreamDiagnosticsOverlay } from './StreamDiagnosticsOverlay';
import { StreamFallbackRenderer } from './StreamFallbackRenderer';
import { AvccWebCodecsRenderer, type AvccWebCodecsRendererProps } from './renderers/AvccWebCodecsRenderer';
import { MjpegImageRenderer } from './renderers/MjpegImageRenderer';
import { streamPlayerStyles } from './styles';

export type { LiveStreamPlayerDisplayState };
type AvccInput = Omit<AvccWebCodecsRendererProps, 'style' | 'testID'>;

const host: HappierLiveStreamPlayerHost<LiveStreamPlayerDisplayState, AvccInput> = {
    reduceDisplayState: reduceLiveStreamPlayerDisplayState,
    renderRoot: (children, input) => <View testID={input.testID} style={streamPlayerStyles.root}>{children}</View>,
    renderSurface: (children) => <View style={streamPlayerStyles.surface}>{children}</View>,
    renderImage: (input) => <MjpegImageRenderer {...input} style={streamPlayerStyles.frame} />,
    renderAvcc: (input) => <AvccWebCodecsRenderer {...input} style={streamPlayerStyles.frame} />,
    renderFallback: (input) => <StreamFallbackRenderer {...input} />,
    renderDiagnostics: (input) => <StreamDiagnosticsOverlay {...input} />,
};

/** Host transport, decoder and themed leaves bind the shared presentation owner. */
export function LiveStreamPlayer(props: Readonly<{
    state: LiveStreamPlayerDisplayState;
    avcc?: AvccInput;
    statusOwnedByHost?: boolean;
    testID: string;
}>): React.ReactElement {
    return <HappierLiveStreamPlayer {...props} host={host} />;
}
