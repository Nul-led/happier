import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { DetailsSpecimen } from '@/components/dev/details/DetailsSpecimen';

/** Dev-only: the Details chrome and kinds (details lab 2). `?only=<frame id>` renders one frame; `?phone=1` the phone step. */
export default function DetailsDevScreen() {
    const params = useLocalSearchParams<{ only?: string; phone?: string }>();
    return (
        <DetailsSpecimen
            only={typeof params.only === 'string' ? params.only : null}
            phone={params.phone === '1'}
        />
    );
}
