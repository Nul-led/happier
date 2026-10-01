import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { HomeHubSpecimen } from '@/components/dev/home/HomeHubSpecimen';

/** Dev-only: the app Home at lab data (lab `hindex` I1; `?machines=1` for I3; `?firstRun=1` for hjourneys J1 with K1). Never reads or writes the Account's Home layout. */
export default function HomeDevScreen() {
    const params = useLocalSearchParams<{ machines?: string; firstRun?: string }>();
    return <HomeHubSpecimen machines={params.machines === '1'} firstRun={params.firstRun === '1'} />;
}
