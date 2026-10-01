import * as React from 'react';

import { presentConnectedAccountIdentity, type ConnectedAccountIdentityPresenter } from '@/sync/domains/connectedServices/maskAccountEmail';
import { useLocalSettingMutable } from '@/sync/store/hooks';

export type { ConnectedAccountIdentityInput, ConnectedAccountIdentityPresenter } from '@/sync/domains/connectedServices/maskAccountEmail';

/**
 * "Hide account emails and IDs" (device-local, off by default) and the one identity presenter every
 * surface renders connected-account identities through: rows, cards, the detail header, the Usage
 * popover, session usage and Home. `hidden` reads the setting; `present` applies
 * `presentConnectedAccountIdentity` with it, so no surface masks on its own.
 */
export function useConnectedAccountIdentityPrivacy(): Readonly<{
    hidden: boolean;
    setHidden: (hidden: boolean) => void;
    present: ConnectedAccountIdentityPresenter;
}> {
    const [value, setValue] = useLocalSettingMutable('hideConnectedAccountIdentities');
    const hidden = value === true;
    const present = React.useCallback<ConnectedAccountIdentityPresenter>((input) => presentConnectedAccountIdentity({
        hidden,
        label: input.label ?? null,
        labelKind: input.labelKind,
        email: input.email ?? null,
        accountId: input.accountId ?? null,
    }), [hidden]);
    return React.useMemo(() => ({ hidden, setHidden: setValue, present }), [hidden, present, setValue]);
}
