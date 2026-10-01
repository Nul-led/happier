import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { CompanionSpecimen } from '@/components/dev/companion/CompanionSpecimen';

/** Dev-only: the Companion column (lab `companion`). `?only=<frame id>` renders one frame; `?phone=1` the phone width. */
export default function CompanionDevScreen() {
    const params = useLocalSearchParams<{ only?: string; phone?: string }>();
    return (
        <CompanionSpecimen
            only={typeof params.only === 'string' ? params.only : null}
            phone={params.phone === '1'}
        />
    );
}
