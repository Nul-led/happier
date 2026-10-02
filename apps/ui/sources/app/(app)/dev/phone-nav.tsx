import { Stack, useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { PhoneSwitcherSpecimen } from '@/components/dev/PhoneSwitcherSpecimen';

/** Dev-only: the phone session switcher (lab `phone-nav2`). `?frame=ghost|lock|scrub|side|sideEnd|dock`. */
export default function PhoneNavDevScreen() {
    const params = useLocalSearchParams<{ frame?: string }>();
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <PhoneSwitcherSpecimen frame={typeof params.frame === 'string' ? params.frame : null} />
        </>
    );
}
