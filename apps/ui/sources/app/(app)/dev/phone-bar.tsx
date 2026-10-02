import { Stack, useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { PhoneBarSpecimen } from '@/components/dev/PhoneBarSpecimen';

/** Dev-only: the Session bar's width policy (lab `phone-nav2` T). `?frame=rest|overflow|always`. */
export default function PhoneBarDevScreen() {
    const params = useLocalSearchParams<{ frame?: string }>();
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <PhoneBarSpecimen frame={typeof params.frame === 'string' ? params.frame : null} />
        </>
    );
}
