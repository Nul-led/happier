import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { ServicesSpecimen } from '@/components/dev/services/ServicesSpecimen';

/** Dev-only: the session's Local services pane with the lab's data. `?phone=1` renders the phone width. */
export default function ServicesDevScreen() {
    const params = useLocalSearchParams<{ phone?: string }>();
    return <ServicesSpecimen phone={params.phone === '1'} />;
}
