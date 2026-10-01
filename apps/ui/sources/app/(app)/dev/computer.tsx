import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { ComputerSpecimen } from '@/components/dev/computer/ComputerSpecimen';

/** Dev-only: the computer-use surfaces of lab `computer`. `?only=<frame id>` renders one frame; `?phone=1` the phone width. */
export default function ComputerDevScreen() {
    const params = useLocalSearchParams<{ only?: string; phone?: string }>();
    return (
        <ComputerSpecimen
            only={typeof params.only === 'string' ? params.only : null}
            phone={params.phone === '1'}
        />
    );
}
