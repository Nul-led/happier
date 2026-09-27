import * as React from 'react';
import { View } from 'react-native';

import { AvatarBrutalist } from '@/components/ui/avatar/AvatarBrutalist';
import { AvatarGradient } from '@/components/ui/avatar/AvatarGradient';
import { AvatarSkia } from '@/components/ui/avatar/AvatarSkia';

/** Stable sample session ids, so the three previews always show the same faces. */
const SAMPLE_IDS = ['happier-sample-a', 'happier-sample-b', 'happier-sample-c'] as const;

/** The real avatar variant for `style`, rendered for three sample sessions. */
export const AvatarStylePreview = React.memo(function AvatarStylePreview(props: Readonly<{
    style: 'pixelated' | 'gradient' | 'brutalist';
}>) {
    const Variant = props.style === 'pixelated' ? AvatarSkia : props.style === 'brutalist' ? AvatarBrutalist : AvatarGradient;
    return (
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {SAMPLE_IDS.map((id) => <Variant key={id} id={id} size={24} />)}
        </View>
    );
});
