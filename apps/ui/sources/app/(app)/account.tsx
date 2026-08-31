import { router, useLocalSearchParams } from 'expo-router';
import * as React from 'react';

import { useAuth } from '@/auth/context/AuthContext';
import { promptAccountConnectApprovalRequired } from '@/components/account/restore/accountConnectApprovalGuidance';
import { fireAndForget } from '@/utils/system/fireAndForget';

export default function LegacyAccountRoute() {
    const params = useLocalSearchParams();
    const auth = useAuth();
    const decision = React.useMemo(() => {
        if (typeof params.accountConnectKey === 'string' && params.accountConnectKey.trim()) {
            return { kind: 'legacy-account-connect' as const };
        }
        if (typeof params.server === 'string' && params.server) {
            return {
                kind: 'redirect' as const,
                href: { pathname: '/settings/account' as const, params: { server: params.server } },
            };
        }
        return { kind: 'redirect' as const, href: '/settings/account' as const };
    }, [params.accountConnectKey, params.server]);
    const handledRequestRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        const requestKey = decision.kind === 'legacy-account-connect'
            ? 'legacy-account-connect'
            : `redirect:${JSON.stringify(decision.href)}`;
        if (handledRequestRef.current === requestKey) return;
        handledRequestRef.current = requestKey;

        if (decision.kind === 'redirect') {
            router.replace(decision.href);
            return;
        }

        fireAndForget((async () => {
            const action = await promptAccountConnectApprovalRequired();
            if (auth.isAuthenticated) {
                router.replace(action === 'showQr' ? '/settings/add-phone' : '/settings/account');
                return;
            }
            router.replace(action === 'showQr' ? '/restore' : '/');
        })(), { tag: 'LegacyAccountRoute.processAccountConnect' });
    }, [auth.isAuthenticated, decision]);

    return null;
}
