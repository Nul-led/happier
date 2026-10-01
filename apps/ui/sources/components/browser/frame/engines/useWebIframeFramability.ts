import * as React from 'react';

/**
 * The framability verdict for a web external URL embedded in an iframe. Cross-origin framability is
 * NOT detectable synchronously (same-origin policy blocks `contentWindow`/`contentDocument` and the
 * `X-Frame-Options`/CSP `frame-ancestors` response headers are not observable from the parent
 * document). This owner is the single place the web platform decides framable vs. non-framable; the
 * engine selector never decides it.
 *
 * - `pending`: loading, no signal yet.
 * - `slow`: still no signal after {@link WEB_IFRAME_SLOW_HINT_MS}. NOT a refusal: plenty of real
 *   pages take longer than that (a cold dev server, a big bundle). The caller keeps the page and
 *   offers a quiet "Open in your browser" hint; a late `onLoad` still recovers to `framable`.
 * - `framable`: `onLoad` fired and no `onError` — keep the site inline.
 * - `nonFramable`: `onError` fired, the only positive refusal signal the parent can observe. The
 *   caller renders the non-framable fallback and fulfils the open-in-system-browser escape hatch.
 *
 * A timer used to flip every page slower than 4 s to "This site refuses to be embedded" (H-UX F-15,
 * E-OE F07): a false negative from a timer standing in for a signal. The timer now only decides when
 * to *offer* the escape, never what the page is.
 */
export type WebIframeFramabilityVerdict = 'pending' | 'slow' | 'framable' | 'nonFramable';

/**
 * When a still-loading frame starts offering the escape. A presentation delay, not a limit: long
 * enough that a normal load never flashes the hint, short enough that a user looking at a blank
 * frame is not left without a way out. Nothing is decided or cancelled when it fires.
 */
export const WEB_IFRAME_SLOW_HINT_MS = 4000;

export type WebIframeFramabilityController = Readonly<{
    verdict: WebIframeFramabilityVerdict;
    /** Wire to the iframe `onLoad`. A load at any time concludes the site is framable. */
    onLoad: () => void;
    /** Wire to the iframe `onError`. Concludes the site is non-framable. */
    onError: () => void;
}>;

/**
 * Track one iframe URL's framability. Resets whenever the URL or `navigationKey` changes so each
 * navigation is judged afresh. `timeoutMs` (the slow-hint delay) is injectable for tests.
 */
export function useWebIframeFramability(params: Readonly<{
    url: string | null;
    navigationKey?: string;
    timeoutMs?: number;
}>): WebIframeFramabilityController {
    const timeoutMs = params.timeoutMs ?? WEB_IFRAME_SLOW_HINT_MS;
    const resetKey = `${params.url ?? ''}:${params.navigationKey ?? ''}`;
    const [verdict, setVerdict] = React.useState<WebIframeFramabilityVerdict>('pending');
    const settledRef = React.useRef(false);

    React.useEffect(() => {
        settledRef.current = false;
        setVerdict('pending');
        if (!params.url) {
            return undefined;
        }
        const handle = setTimeout(() => {
            if (settledRef.current) {
                return;
            }
            // Not settled: a late load or error still decides.
            setVerdict('slow');
        }, timeoutMs);
        return () => {
            clearTimeout(handle);
        };
        // resetKey captures url + navigationKey; timeoutMs is stable per mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey, timeoutMs]);

    const onLoad = React.useCallback(() => {
        if (settledRef.current) {
            return;
        }
        settledRef.current = true;
        setVerdict('framable');
    }, []);

    const onError = React.useCallback(() => {
        if (settledRef.current) {
            return;
        }
        settledRef.current = true;
        setVerdict('nonFramable');
    }, []);

    return { verdict, onLoad, onError };
}
