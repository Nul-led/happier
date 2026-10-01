import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { PaneStatesSpecimen } from '@/components/dev/paneStates/PaneStatesSpecimen';

/** Dev-only: the pane-states composition board (lab 0 S/S2). `?only=<row title>` renders one row. */
export default function PaneStatesDevScreen() {
    const params = useLocalSearchParams<{ only?: string }>();
    return <PaneStatesSpecimen only={typeof params.only === 'string' ? params.only : null} />;
}
