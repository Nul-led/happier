import * as React from 'react';

import { RelayDriftNotice } from '@/components/settings/server/RelayDriftNotice';
import { useRelayDriftBanner } from '@/components/settings/server/useRelayDriftBanner';

/** Relay drift concerns every machine page, so the Machines collection shows it above the open detail. */
export const MachinesRelayDriftBanner = React.memo(function MachinesRelayDriftBanner() {
    const banner = useRelayDriftBanner();
    return banner ? <RelayDriftNotice banner={banner} testID="settings.machines.relayDrift.webNotice" /> : null;
});
