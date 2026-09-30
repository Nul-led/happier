import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createReactNativeAppStateEmitter } from '@/dev/testkit/mocks/reactNative';
import { AppState } from 'react-native';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@hugeicons/react-native', () => ({
    HugeiconsIcon: (props: Record<string, unknown>) => React.createElement('HugeiconsIcon', props),
}));

import { SessionUsageLimitRecoveryBanner } from './SessionUsageLimitRecoveryBanner';

describe('overload recovery countdown', () => {
    let restoreAppState: (() => void) | null = null;
    afterEach(() => { restoreAppState?.(); vi.unstubAllGlobals(); vi.useRealTimers(); });
    it('pauses its real countdown on Tauri blur without hiding and resumes on focus', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        let focused = true;
        const doc = new EventTarget();
        Object.defineProperties(doc, {
            visibilityState: { value: 'visible' },
            hasFocus: { value: () => focused },
        });
        const win = new EventTarget();
        vi.stubGlobal('isTauri', true);
        vi.stubGlobal('document', doc);
        vi.stubGlobal('window', win);
        const screen = await renderScreen(<SessionUsageLimitRecoveryBanner testID="focus-recovery"
            title="Model overloaded" body="Waiting" surfaceFocused
            temporaryThrottle={{ nextCheckAtMs: Date.now() + 12_000, attemptCount: 2 }} />);
        try {
            expect(screen.getTextContent()).toContain('12 seconds');
            expect(vi.getTimerCount()).toBe(1);
            focused = false;
            await act(async () => { win.dispatchEvent(new Event('blur')); });
            expect(vi.getTimerCount()).toBe(0);
            await act(async () => { vi.advanceTimersByTime(3_000); });
            expect(screen.getTextContent()).toContain('12 seconds');
            focused = true;
            await act(async () => { win.dispatchEvent(new Event('focus')); });
            expect(vi.getTimerCount()).toBe(1);
            expect(screen.getTextContent()).toContain('9 seconds');
            await act(async () => { vi.advanceTimersByTime(1_000); });
            expect(screen.getTextContent()).toContain('8 seconds');
        } finally {
            await act(async () => { screen.tree.unmount(); });
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('starts its real countdown when an initially unfocused Tauri window gains focus', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        let focused = false;
        const doc = new EventTarget();
        Object.defineProperties(doc, {
            visibilityState: { value: 'visible' },
            hasFocus: { value: () => focused },
        });
        const win = new EventTarget();
        vi.stubGlobal('isTauri', true);
        vi.stubGlobal('document', doc);
        vi.stubGlobal('window', win);
        const screen = await renderScreen(<SessionUsageLimitRecoveryBanner testID="focus-recovery"
            title="Model overloaded" body="Waiting" surfaceFocused
            temporaryThrottle={{ nextCheckAtMs: Date.now() + 12_000, attemptCount: 2 }} />);
        try {
            expect(vi.getTimerCount()).toBe(0);
            await act(async () => { vi.advanceTimersByTime(3_000); });
            focused = true;
            await act(async () => { win.dispatchEvent(new Event('focus')); });
            expect(vi.getTimerCount()).toBe(1);
            expect(screen.getTextContent()).toContain('9 seconds');
            await act(async () => { vi.advanceTimersByTime(1_000); });
            expect(screen.getTextContent()).toContain('8 seconds');
        } finally {
            await act(async () => { screen.tree.unmount(); });
        }
        expect(vi.getTimerCount()).toBe(0);
    });

    it('updates only the banner leaf and removes its timer when no scheduled retry remains', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_000_000);
        const appState = createReactNativeAppStateEmitter();
        restoreAppState = appState.install(AppState);
        let parentRenders = 0;
        function Parent({ deadline, focused = true }: { deadline: number | null; focused?: boolean }) {
            parentRenders += 1;
            return <SessionUsageLimitRecoveryBanner testID="recovery" title="Model overloaded" body="Waiting"
                surfaceFocused={focused} temporaryThrottle={{ nextCheckAtMs: deadline, attemptCount: 2 }} />;
        }
        const screen = await renderScreen(<Parent deadline={Date.now() + 12_000} />);
        expect(screen.getTextContent()).toContain('12 seconds');
        expect(screen.getTextContent()).toContain('attempt 3');
        const parentBeforeTick = parentRenders;
        await act(async () => { vi.advanceTimersByTime(3_000); });
        expect(screen.getTextContent()).toContain('9 seconds');
        expect(parentRenders).toBe(parentBeforeTick);
        await act(async () => { appState.emit('background'); });
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => { appState.emit('active'); });
        await act(async () => { screen.tree.update(<Parent deadline={null} />); });
        expect(screen.getTextContent()).not.toContain('seconds');
        expect(vi.getTimerCount()).toBe(0);
        await act(async () => { screen.tree.update(<Parent deadline={Date.now() + 12_000} focused={false} />); });
        expect(vi.getTimerCount()).toBe(0);
    });
});
