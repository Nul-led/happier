import * as React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { resolveLegacyAccountEntryRedirect } from '@/components/navigation/accountEntry/authenticatedAccountEntryRoute';
import { buildMachineAddHref } from '@/components/settings/machines/collection/machineCollectionModel';

export default function SetupWizardRoute() {
    const params = useLocalSearchParams() as Readonly<Record<string, string | string[] | undefined>>;
    const accountEntry = resolveLegacyAccountEntryRedirect(params);
    if (accountEntry) {
        return <Redirect href={accountEntry} />;
    }

    const scope = typeof params.scope === 'string' ? params.scope.trim() : '';
    if (scope === 'machine') {
        const action = typeof params.action === 'string' ? params.action.trim() : '';
        const path = action === 'local' ? 'thisComputer' : action === 'remote' ? 'ssh' : undefined;
        return <Redirect href={buildMachineAddHref({ path })} />;
    }
    if (scope === 'relay') {
        return <Redirect href="/settings/server/add?path=server_home" />;
    }
    return <Redirect href="/" />;
}
