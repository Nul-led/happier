import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { RunPageSpecimen } from '@/components/dev/runPage/RunPageSpecimen';

/** Dev-only: the Run page specimen (agents lab RP1/MN/CV/ST/LN). `?frame=RP1|CV|ST|LN`. */
export default function RunPageDevScreen() {
    const params = useLocalSearchParams<{ frame?: string }>();
    return <RunPageSpecimen frame={typeof params.frame === 'string' ? params.frame : null} />;
}
