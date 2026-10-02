import { Stack, useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { PhoneTabsSpecimen } from '@/components/dev/PhoneTabsSpecimen';

/** Dev-only: the phone's open-tabs rail (phone-nav lab R/K). `?frame=rail|preview|unavailable`. */
export default function PhoneTabsDevScreen() {
    const params = useLocalSearchParams<{ frame?: string }>();
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <PhoneTabsSpecimen frame={typeof params.frame === 'string' ? params.frame : null} />
        </>
    );
}
