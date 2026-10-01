import * as React from 'react';
import { usePathname } from 'expo-router';
import type { EmbedStyleV1 } from '@happier-dev/protocol/embed';

import { useEmbedSessionRuntime } from '@/embed/runtime/EmbedSessionRuntimeProvider';
import { EMBED_PREVIEW_PATH } from '@/embed/preview/embedPreviewRoute';
import { watchEmbedSessionActivity, type EmbedActivity } from '@/embed/state/embedSessionActivity';
import { applyEmbedStyle, createDefaultEmbedStyleDependencies, mergeEmbedStyles } from '@/embed/style/embedStyleTheme';
import { storage } from '@/sync/domains/state/storage';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { startEmbedBridgeGuest, type EmbedBridgeGuest } from './embedBridgeGuest';

function readFrameIdentity(): Readonly<{ instanceId: string; mountNonce: string }> | null {
    if (typeof window === 'undefined') return null;
    const search = new URLSearchParams(window.location.search);
    const instanceId = search.get('i')?.trim() ?? '';
    const mountNonce = search.get('n')?.trim() ?? '';
    return instanceId && mountNonce ? { instanceId, mountNonce } : null;
}

const styleDependencies = createDefaultEmbedStyleDependencies((delta, options) => {
    storage.getState().applyLocalSettings(delta, options);
});

/**
 * The embed frame's bridge (plan 04 §4.3, U2c): the one guest for the page, connected to the embed
 * runtime (C04) that owns credential admission and lifecycle. It forwards `init`, `open` and
 * `configure`, answers the runtime's credential requests over the port, applies the embed's style
 * (saved configuration < host runtime style) through the theme owner, and reports `state` with the
 * session's activity to the host.
 */
export function EmbedBridgeRuntime(): null {
    const { runtime, snapshot } = useEmbedSessionRuntime();
    const pathname = usePathname();
    const guestRef = React.useRef<EmbedBridgeGuest | null>(null);
    const [hostStyle, setHostStyle] = React.useState<EmbedStyleV1 | null>(null);
    const [initialized, setInitialized] = React.useState(false);
    const [activity, setActivity] = React.useState<EmbedActivity | undefined>(undefined);
    const preview = pathname === EMBED_PREVIEW_PATH;

    React.useEffect(() => {
        const identity = readFrameIdentity();
        if (preview || !identity || typeof window === 'undefined') return undefined;
        const guest = startEmbedBridgeGuest({
            window,
            identity,
            embedPublicKey: runtime.embedPublicKey,
            events: {
                onInit: (init, parentOrigin) => {
                    setHostStyle(init.style ?? null);
                    setInitialized(true);
                    fireAndForget(runtime.initialize({
                        parentOrigin,
                        credential: init.credential,
                        ...(init.sessionId ? { sessionId: init.sessionId } : {}),
                        ...(init.ui ? { ui: init.ui } : {}),
                    }), { tag: 'EmbedBridgeRuntime.initialize' });
                },
                onConfigure: (configure) => {
                    if (configure.style) setHostStyle((current) => mergeEmbedStyles(current, configure.style));
                    // The runtime replaces its UI overrides on configure, so a style-only update leaves them alone.
                    if (configure.ui) runtime.configure({ ui: configure.ui });
                },
                onOpen: (open) => {
                    fireAndForget(runtime.open(open.sessionId), { tag: 'EmbedBridgeRuntime.open' });
                },
            },
        });
        guestRef.current = guest;
        const detach = runtime.attachBridge({
            requestCredential: async ({ kind: _kind, ...request }) => {
                const outcome = await guest.requestCredential(request);
                if (outcome.kind === 'credential') return outcome.credential;
                const code = outcome.kind === 'error' ? outcome.code : 'credential_unavailable';
                throw Object.assign(new Error(code), { code });
            },
            sessionCreated: (sessionId) => guest.publishSessionCreated(sessionId),
        });
        return () => {
            detach();
            guest.dispose();
            if (guestRef.current === guest) guestRef.current = null;
        };
    }, [preview, runtime]);

    // Style: the Happier default < the embed's saved style (self) < the host's runtime style.
    const savedStyle = snapshot.self?.embedConfig?.style ?? null;
    React.useEffect(() => {
        if (preview || !initialized) return;
        fireAndForget(applyEmbedStyle(mergeEmbedStyles(savedStyle, hostStyle), styleDependencies), { tag: 'EmbedBridgeRuntime.style' });
    }, [hostStyle, initialized, preview, savedStyle]);

    const displayedSessionId = snapshot.phase === 'ready' ? snapshot.displayedSessionId : null;
    React.useEffect(() => {
        setActivity(undefined);
        if (!displayedSessionId) return undefined;
        return watchEmbedSessionActivity({ sessionId: displayedSessionId, onActivity: setActivity });
    }, [displayedSessionId]);

    React.useEffect(() => {
        const guest = guestRef.current;
        if (!guest || !initialized) return;
        guest.publishState({
            sessionId: snapshot.displayedSessionId ?? snapshot.requestedSessionId,
            phase: snapshot.phase,
            ...(snapshot.phase === 'ready' && activity ? { activity } : {}),
            ...(snapshot.error ? { error: snapshot.error } : {}),
        });
    }, [activity, initialized, snapshot.displayedSessionId, snapshot.error, snapshot.phase, snapshot.requestedSessionId]);

    return null;
}
