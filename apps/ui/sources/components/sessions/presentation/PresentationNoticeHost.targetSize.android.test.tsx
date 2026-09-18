import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flattenTestStyle, renderScreen, standardCleanup } from '@/dev/testkit';

vi.mock('react-native', async () => (
    await import('@/dev/testkit/mocks/reactNative')
).createReactNativeNativeMock({ platformOS: 'android' }));

import { publishPresentationNotice, retirePresentationNotice } from './presentationNotices';
import { PresentationNoticeHost } from './PresentationNoticeHost';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    retirePresentationNotice();
    standardCleanup();
});

describe('PresentationNoticeHost Android target', () => {
    // A copied 44 is an iOS number. Undo is the one thing a person can press here,
    // and it appears on a transient card that leaves after a few seconds.
    it('uses the canonical 48dp minimum interactive target for Undo', async () => {
        publishPresentationNotice({
            key: 'notice-android-target',
            message: 'Added to Companion',
            severity: 'info',
            undo: { label: 'Undo', run: () => {} },
        });

        const screen = await renderScreen(<PresentationNoticeHost />);
        const styleProp = screen.findHostByTestId('current-session-presentation-notice-undo')?.props.style;
        const style = flattenTestStyle(
            typeof styleProp === 'function' ? styleProp({ pressed: false }) : styleProp,
        );

        expect(style.minHeight).toBe(48);
    });

    // React Native removes a `pointerEvents="none"` view AND its whole subtree
    // from hit-testing; only `box-none` lets the host stay passive while its
    // child control receives the tap. A dead Undo here is invisible to web QA.
    it('lets a thumb reach Undo through the passive host', async () => {
        const run = vi.fn();
        publishPresentationNotice({
            key: 'notice-android-undo',
            message: 'Added to Companion',
            severity: 'info',
            undo: { label: 'Undo', run },
        });

        const screen = await renderScreen(<PresentationNoticeHost />);

        expect(screen.findByTestId('current-session-presentation-notice')?.props.pointerEvents)
            .toBe('box-none');
        screen.pressByTestId('current-session-presentation-notice-undo');
        expect(run).toHaveBeenCalledOnce();
    });
});
