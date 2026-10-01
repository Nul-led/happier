import { useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { ConnectedServicesSpecimen } from '@/components/dev/connectedServices/ConnectedServicesSpecimen';

/** Dev-only: the Connected services surfaces with fixture accounts (lab `csvc`). `?frame=<id>`. */
export default function ConnectedServicesDevScreen() {
    const params = useLocalSearchParams<{ frame?: string }>();
    return <ConnectedServicesSpecimen frame={typeof params.frame === 'string' ? params.frame : null} />;
}
