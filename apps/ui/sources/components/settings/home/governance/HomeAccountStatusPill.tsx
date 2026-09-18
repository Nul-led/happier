import * as React from 'react';
import type { HomeAccountRowV1 } from '@happier-dev/protocol/home/governance';

import { StatusPill } from '@/components/ui/status/StatusPill';
import { resolveHomeAccountStatusPresentation } from '@/sync/domains/home/governance/homeAccountAdministration';

import { homeAccountStatusLabel } from './homeGovernanceLabels';

/** A labelled lifecycle marker shared by the Home roster and Account detail. */
export const HomeAccountStatusPill = React.memo(function HomeAccountStatusPill(
    props: Readonly<{ row: Pick<HomeAccountRowV1, 'status'>; testID?: string }>,
) {
    const presentation = resolveHomeAccountStatusPresentation(props.row.status);
    if (presentation.label === 'active') return null;
    return (
        <StatusPill
            testID={props.testID}
            variant={presentation.reversible ? 'warning' : 'neutral'}
            label={homeAccountStatusLabel(props.row.status)}
            labelVariant="phrase"
        />
    );
});
