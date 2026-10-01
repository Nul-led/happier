import * as React from 'react';
import type { AccountDirectoryAuthTransport } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { WizardModalShell } from '@/components/onboarding/ui/WizardModalShell';
import { t } from '@/text';

import type { AuthenticatedAccountEntryRequest } from './authenticatedAccountEntryRoute';
import { useAccountEntryFlow } from './useAccountEntryFlow';

/** The `/homes/sign-in` route's body: the account-entry flow in the wizard shell. */
export function AuthenticatedAccountEntryRouteSurface(props: Readonly<{
    request: AuthenticatedAccountEntryRequest;
    routeParams: Readonly<Record<string, string | string[] | undefined>>;
    transport?: AccountDirectoryAuthTransport;
    onExit: (returnTo: string) => void;
}>): React.ReactElement {
    const flow = useAccountEntryFlow(props);
    const title = props.request.intent.kind === 'link' ? t('settingsAccount.accountServiceLinkThisHome') : t('settingsAccount.accountServiceHomes');
    return <WizardModalShell testID="authenticated-account-entry-wizard" stepIndex={flow.stage === 'methods' ? 0 : 1}
        stepCount={2} layoutPresentation="auto" title={title} subtitle={flow.serviceName} showSkip={false} onBack={flow.exit}>
        {flow.content}
    </WizardModalShell>;
}
