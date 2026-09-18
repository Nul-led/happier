import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';

type HardwareBackHandler = () => boolean | null | undefined;

const nativeBack = vi.hoisted(() => {
    let handlers: HardwareBackHandler[] = [];
    return {
        addEventListener: vi.fn((_eventName: string, handler: HardwareBackHandler) => {
            handlers = [...handlers, handler];
            return {
                remove: () => { handlers = handlers.filter((candidate) => candidate !== handler); },
            };
        }),
        emit() {
            for (const handler of [...handlers].reverse()) {
                if (handler()) return true;
            }
            return false;
        },
        reset() {
            handlers = [];
            this.addEventListener.mockClear();
        },
    };
});

vi.mock('react-native', async () => {
    const { createReactNativeNativeMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeNativeMock({ platformOS: 'android' }, {
        View: 'View',
        BackHandler: nativeBack,
    });
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key: string) => key });
});

async function surface(overlay: React.ReactNode | null, onRequestClose: () => void): Promise<React.ReactElement> {
    const { NewSessionLaunchSurface } = await import('./NewSessionLaunchSurface');
    return (
        <NewSessionLaunchSurface overlay={overlay} onRequestClose={onRequestClose}>
            {React.createElement('View', { testID: 'authoring-tree' })}
        </NewSessionLaunchSurface>
    );
}

describe('NewSessionLaunchSurface native Back and accessibility', () => {
    beforeEach(() => { nativeBack.reset(); });
    afterEach(() => { nativeBack.reset(); });

    it('routes native Back to the launch cancellation owner only while an attempt owns the screen', async () => {
        const onRequestClose = vi.fn();

        const screen = await renderScreen(await surface(null, onRequestClose));
        await flushHookEffects({ cycles: 2, turns: 2 });
        expect(nativeBack.emit()).toBe(false);
        expect(onRequestClose).not.toHaveBeenCalled();

        await screen.update(await surface(React.createElement('View', { testID: 'launch-overlay' }), onRequestClose));
        await flushHookEffects({ cycles: 2, turns: 2 });

        expect(nativeBack.emit()).toBe(true);
        expect(onRequestClose).toHaveBeenCalledTimes(1);

        // Back never unmounts the retained draft; only the launch owner decides.
        expect(screen.findByTestId('authoring-tree')).not.toBeNull();
        await screen.unmount();
    });

    it('hides the retained authoring tree from native accessibility and labels the launch dialog', async () => {
        const screen = await renderScreen(
            await surface(React.createElement('View', { testID: 'launch-overlay' }), () => undefined),
        );
        await flushHookEffects({ cycles: 2, turns: 2 });

        const authoring = screen.findByTestId('new-session-launch-authoring');
        expect(authoring?.props.accessibilityElementsHidden).toBe(true);
        expect(authoring?.props.importantForAccessibility).toBe('no-hide-descendants');
        expect(authoring?.props.pointerEvents).toBe('none');
        // Web-only DOM attributes must not leak into the native tree.
        expect(authoring?.props.inert).toBeUndefined();
        expect(authoring?.props['aria-hidden']).toBeUndefined();

        const overlay = screen.findByTestId('new-session-launch-overlay');
        expect(overlay?.props.accessibilityViewIsModal).toBe(true);
        expect(overlay?.props.accessibilityLabel).toBe('newSession.temporaryComputer.title');
        expect(overlay?.props.role).toBeUndefined();

        await screen.unmount();
    });
});
