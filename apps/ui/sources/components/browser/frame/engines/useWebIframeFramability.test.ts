import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

import { useWebIframeFramability } from './useWebIframeFramability';

describe('useWebIframeFramability', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts pending and stays inline (framable) when onLoad fires before the timeout', async () => {
        const result = await renderHook(() => useWebIframeFramability({
            url: 'https://example.com/',
            timeoutMs: 4000,
        }));

        expect(result.getCurrent().verdict).toBe('pending');

        await act(async () => {
            result.getCurrent().onLoad();
        });
        expect(result.getCurrent().verdict).toBe('framable');

        // The timeout must not later override a framable verdict.
        await act(async () => {
            vi.advanceTimersByTime(8000);
        });
        expect(result.getCurrent().verdict).toBe('framable');
    });

    it('never concludes non-framable on a timer: a slow page only earns a hint and recovers when it loads (E-OE F07)', async () => {
        const result = await renderHook(() => useWebIframeFramability({
            url: 'https://slow-but-framable.test/',
            timeoutMs: 4000,
        }));

        expect(result.getCurrent().verdict).toBe('pending');
        await act(async () => {
            vi.advanceTimersByTime(4000);
        });
        expect(result.getCurrent().verdict).toBe('slow');

        await act(async () => {
            result.getCurrent().onLoad();
        });
        expect(result.getCurrent().verdict).toBe('framable');
    });

    it('concludes non-framable immediately when onError fires', async () => {
        const result = await renderHook(() => useWebIframeFramability({
            url: 'https://error.test/',
            timeoutMs: 4000,
        }));

        await act(async () => {
            result.getCurrent().onError();
        });
        expect(result.getCurrent().verdict).toBe('nonFramable');
    });

    it('re-judges from pending when the url changes', async () => {
        const result = await renderHook(
            (props: { url: string }) => useWebIframeFramability({ url: props.url, timeoutMs: 4000 }),
            { initialProps: { url: 'https://first.test/' } },
        );
        await act(async () => {
            result.getCurrent().onLoad();
        });
        expect(result.getCurrent().verdict).toBe('framable');

        await result.rerender({ url: 'https://second.test/' });
        expect(result.getCurrent().verdict).toBe('pending');
    });
});
