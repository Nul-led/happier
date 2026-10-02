import { Stack, useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { TerminalPhoneSpecimen } from '@/components/dev/terminal/phone/TerminalPhoneSpecimen';

/** Dev-only: the phone Terminal page (terminal lab P1). `?v=P1|P1c|P1m|A1p|B2p|STp`. */
export default function TerminalPhoneDevScreen() {
    const params = useLocalSearchParams<{ v?: string }>();
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <TerminalPhoneSpecimen variant={typeof params.v === 'string' ? params.v : null} />
        </>
    );
}
