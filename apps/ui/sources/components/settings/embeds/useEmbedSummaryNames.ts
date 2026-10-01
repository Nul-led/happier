import * as React from 'react';

import { useApiTokenGrantNames } from '@/components/settings/apiTokens/grant/useApiTokenGrantCatalogs';

import type { EmbedSummaryNames } from './embedPresentation';
import { useEmbedOrganizationNames } from './useEmbedOrganizationNames';

/** Model and folder names for embed rows, from the grant catalog owner and the Home's organization. */
export function useEmbedSummaryNames(): EmbedSummaryNames {
    const grantNames = useApiTokenGrantNames();
    const organization = useEmbedOrganizationNames();
    return React.useMemo(() => ({
        modelName: grantNames.modelName,
        folderName: organization.folderName,
    }), [grantNames.modelName, organization.folderName]);
}
