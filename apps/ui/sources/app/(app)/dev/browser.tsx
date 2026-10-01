import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { BrowserSpecimen } from '@/components/dev/browser/BrowserSpecimen';

/** Dev-only: the browser surfaces of lab `browser`. `?only=<frame id>` renders one frame; `?phone=1` the phone width. */
export default function BrowserDevScreen() {
    const params = useLocalSearchParams<{ only?: string; phone?: string }>();
    return (
        <BrowserSpecimen
            only={typeof params.only === 'string' ? params.only : null}
            phone={params.phone === '1'}
        />
    );
}
