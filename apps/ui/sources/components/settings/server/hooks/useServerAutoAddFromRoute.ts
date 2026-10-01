import * as React from 'react';

import { t } from '@/text';
import {
    connectHomeAtAddress,
    type ConnectHomeAtAddressResult,
} from '@/sync/ops/home/connectHomeAtAddress';
import {
    confirmCanonicalHomeUrl,
    confirmInsecureHomeHttp,
    homeConnectFailureMessage,
} from '@/components/homes/add/homeConnectPresentation';
import { fireAndForget } from '@/utils/system/fireAndForget';

type RouteHomeConnectionState = Readonly<{
    isConnecting: boolean;
    result: ConnectHomeAtAddressResult | null;
    error: string | null;
}>;

export function useServerAutoAddFromRoute(params: Readonly<{
    enabled: boolean;
    address: string | null | undefined;
    source: 'url' | 'manual' | 'notification';
    confirmInsecureHttp?: () => Promise<boolean>;
    confirmCanonicalUrl?: () => Promise<boolean>;
}>): RouteHomeConnectionState {
    const handledRef = React.useRef(false);
    const controllerRef = React.useRef<AbortController | null>(null);
    const mountedRef = React.useRef(true);
    const [state, setState] = React.useState<RouteHomeConnectionState>({
        isConnecting: false,
        result: null,
        error: null,
    });

    React.useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            controllerRef.current?.abort();
        };
    }, []);

    React.useEffect(() => {
        if (!params.enabled || !params.address || handledRef.current) return;
        handledRef.current = true;
        const address = params.address;
        const controller = new AbortController();
        controllerRef.current = controller;
        setState({ isConnecting: true, result: null, error: null });

        fireAndForget((async () => {
            let result: ConnectHomeAtAddressResult;
            try {
                result = await connectHomeAtAddress({
                    serverUrl: address,
                    source: params.source,
                    signal: controller.signal,
                    confirmInsecureHttp: params.confirmInsecureHttp ?? confirmInsecureHomeHttp,
                    confirmCanonicalUrl: params.confirmCanonicalUrl ?? confirmCanonicalHomeUrl,
                });
            } catch (error) {
                if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
                    if (mountedRef.current) setState({ isConnecting: false, result: null, error: null });
                    return;
                }
                throw error;
            }
            if (!mountedRef.current) return;
            const error = homeConnectFailureMessage(result);
            setState({ isConnecting: false, result, error });
        })(), {
            tag: 'useServerAutoAddFromRoute.autoAdd',
            onError: () => {
                if (!mountedRef.current) return;
                const message = t('errors.operationFailed');
                setState({ isConnecting: false, result: null, error: message });
            },
        });
    }, [params]);

    return state;
}
