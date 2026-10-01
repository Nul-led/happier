import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { renderCollectionFrame } from './collectionFrames';
import { renderPoolFrame } from './poolFrames';
import { renderSetupFrame } from './setupFrames';
import { renderUsageFrame } from './usageFrames';

/**
 * Dev-only preview of the Connected services surfaces (lab `csvc`) fed by fixtures through the real
 * components and model owners, for fidelity pairs of states a dev Home without connected accounts
 * cannot show. `?frame=<id>`: collection (C1, C2, C1v, D1, D2, MT), pool, usage and set-up frames live in their
 * slices' files. Never linked from product surfaces.
 */
export function ConnectedServicesSpecimen(props: Readonly<{ frame: string | null }>) {
    const frame = props.frame ?? 'C1';
    // The capture script waits for this marker so a screenshot never races the frame's first render.
    return (
        <View style={styles.page} testID={`connected-services-specimen-${frame}`}>
            <SpecimenFrame frame={frame} />
        </View>
    );
}

function SpecimenFrame(props: Readonly<{ frame: string }>) {
    const frame = props.frame;
    // Each slice renders its own frames (pool, usage, set-up); the rest are the page's.
    const sliceFrame = renderCollectionFrame(frame) ?? renderPoolFrame(frame) ?? renderUsageFrame(frame) ?? renderSetupFrame(frame);
    return <>{sliceFrame ?? renderCollectionFrame('C1')}</>;
}

const styles = StyleSheet.create((theme) => ({
    page: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
    },
}));
