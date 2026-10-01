import * as React from 'react';
import { useFocusEffect } from '@react-navigation/native';

import {
    mergeNewSessionHostParams,
    type NewSessionEmbeddedHost,
    type NewSessionHostDraftEntry,
    type NewSessionHostParams,
} from './newSessionHost';
import { useResolveNewSessionOrdinaryEntryRoute } from './newSessionOrdinaryEntryRoute';

function paramsForDraft(entry: NewSessionHostDraftEntry): NewSessionHostParams {
    return entry.draftOrigin ? { draftId: entry.draftId, draftOrigin: entry.draftOrigin } : { draftId: entry.draftId };
}

/**
 * The state an embedding page (Home) keeps for its New Session surface: the params the route
 * would otherwise hold, starting on the ordinary-entry draft — the same draft "+" opens — and
 * the intent signal that lets closed chips stay RPC-free until the person reaches for them.
 *
 * After the surface hands its draft to a created session, the next time the page is focused it
 * starts a fresh ordinary draft, so returning Home never shows the draft that already launched.
 */
export function useNewSessionEmbeddedHostState(): Readonly<{
    host: NewSessionEmbeddedHost;
    markDemanded: () => void;
}> {
    const resolveOrdinaryEntry = useResolveNewSessionOrdinaryEntryRoute();
    const [params, setParamsState] = React.useState<NewSessionHostParams>(() => paramsForDraft(resolveOrdinaryEntry()));
    const [demanded, setDemanded] = React.useState(false);
    const handedOffRef = React.useRef(false);

    const setParams = React.useCallback((patch: Readonly<Record<string, unknown>>) => {
        setParamsState((current) => mergeNewSessionHostParams(current, patch));
    }, []);
    const openDraft = React.useCallback((entry: NewSessionHostDraftEntry) => {
        setParamsState(paramsForDraft(entry));
    }, []);
    const onHandedOff = React.useCallback(() => {
        handedOffRef.current = true;
    }, []);
    const markDemanded = React.useCallback(() => {
        setDemanded(true);
    }, []);

    useFocusEffect(React.useCallback(() => {
        if (!handedOffRef.current) return;
        handedOffRef.current = false;
        setParamsState(paramsForDraft(resolveOrdinaryEntry({ forceFresh: true })));
    }, [resolveOrdinaryEntry]));

    const host = React.useMemo<NewSessionEmbeddedHost>(() => ({
        params,
        setParams,
        openDraft,
        onHandedOff,
        demanded,
    }), [demanded, onHandedOff, openDraft, params, setParams]);

    return { host, markDemanded };
}
