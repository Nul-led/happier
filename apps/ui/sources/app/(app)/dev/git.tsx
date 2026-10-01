import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { GitSpecimen } from '@/components/dev/git/GitSpecimen';

/** Dev-only: the session Git pane (Git lab). `?only=<frame id>` renders one frame; `?phone=1` the phone step. */
export default function GitDevScreen() {
    const params = useLocalSearchParams<{ only?: string; phone?: string }>();
    return (
        <GitSpecimen
            only={typeof params.only === 'string' ? params.only : null}
            phone={params.phone === '1'}
        />
    );
}
