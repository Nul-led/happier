import { Stack, useLocalSearchParams } from 'expo-router';
import * as React from 'react';
import { WorkspaceSpecimen } from '@/components/dev/WorkspaceSpecimen';

/** Dev-only workspace tab/title/status fixture; ?frame=T|V|S. */
export default function WorkspaceDevScreen() {
    const params = useLocalSearchParams<{ frame?: string }>();
    return <>
        <Stack.Screen options={{ headerShown: false }} />
        <WorkspaceSpecimen frame={typeof params.frame === 'string' ? params.frame : null} />
    </>;
}
