import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { NavigateSpecimen } from '@/components/dev/navigate/NavigateSpecimen';

/** Dev-only: the Navigate pane (lab `navigate`). `?only=<frame id>` renders one frame; `?phone=1` the phone width. */
export default function NavigateDevScreen() {
    const params = useLocalSearchParams<{ only?: string; phone?: string }>();
    return (
        <NavigateSpecimen
            only={typeof params.only === 'string' ? params.only : null}
            phone={params.phone === '1'}
        />
    );
}
