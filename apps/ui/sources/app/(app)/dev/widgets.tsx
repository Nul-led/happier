import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { WidgetsSpecimen } from '@/components/dev/widgets/WidgetsSpecimen';

/** Dev-only: Board & Companion widgets (lab `cwidgets`). `?only=<frame id>` renders one frame; `?phone=1` the phone width. */
export default function WidgetsDevScreen() {
    const params = useLocalSearchParams<{ only?: string; phone?: string }>();
    return (
        <WidgetsSpecimen
            only={typeof params.only === 'string' ? params.only : null}
            phone={params.phone === '1'}
        />
    );
}
