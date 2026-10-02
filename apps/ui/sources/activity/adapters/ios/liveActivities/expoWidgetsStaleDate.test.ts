import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
    start: vi.fn(),
    update: vi.fn(async () => undefined),
}));

// Expo's native module is the system boundary; exercise the installed library's real codec.
vi.mock('expo', () => ({
    NativeModule: class {},
    requireNativeModule: () => ({
        LiveActivityFactory: class {
            start = native.start;
        },
    }),
}));

import { LiveActivityFactory } from 'expo-widgets/src/Widgets';
import { LiveActivityFactory as BuiltLiveActivityFactory } from 'expo-widgets/build/Widgets';

describe.each([
    ['source', LiveActivityFactory],
    ['installed runtime', BuiltLiveActivityFactory],
])('expo-widgets Live Activity stale date bridge (%s)', (_name, Factory) => {
    it('carries the content expiry through start and update as epoch milliseconds', async () => {
        native.start.mockReturnValue({ update: native.update });
        const factory = new Factory<{ staleAt: number }>('HappierFocusLiveActivity', () => ({ banner: null }));
        const props = { staleAt: 1_801_000 };
        const activity = factory.start(props, '/session/one', new Date(props.staleAt));

        expect(native.start).toHaveBeenLastCalledWith(JSON.stringify(props), '/session/one', props.staleAt);
        const refreshed = { staleAt: 3_601_000 };
        await activity.update(refreshed, new Date(refreshed.staleAt));
        expect(native.update).toHaveBeenLastCalledWith(JSON.stringify(refreshed), refreshed.staleAt);

        // Existing callers may intentionally omit expiration; preserve the optional API.
        const undated = factory.start(props);
        expect(native.start).toHaveBeenLastCalledWith(JSON.stringify(props), undefined, undefined);
        await undated.update(props);
        expect(native.update).toHaveBeenLastCalledWith(JSON.stringify(props), undefined);
    });
});
