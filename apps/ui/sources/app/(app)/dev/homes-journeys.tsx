import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { HomesJourneysSpecimen } from '@/components/dev/homesJourneys/HomesJourneysSpecimen';

/** Dev-only: the Homes journeys specimen (lab `hjourneys`). `?only=<frame>` renders one frame. */
export default function HomesJourneysDevScreen() {
    const params = useLocalSearchParams<{ only?: string }>();
    return <HomesJourneysSpecimen only={typeof params.only === 'string' ? params.only : null} />;
}
