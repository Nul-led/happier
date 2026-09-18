import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { createDeferred, renderScreen } from '@/dev/testkit';

import { FlowSurfaceActions } from './FlowSurfaceActions';

describe('FlowSurfaceActions', () => {
    it('preserves the primary action Promise for same-control admission', async () => {
        const deferred = createDeferred<void>();
        const onPress = vi.fn(() => deferred.promise);
        const screen = await renderScreen(
            <FlowSurfaceActions primary={{ label: 'Continue', onPress, testID: 'flow-primary' }} />,
        );

        screen.pressByTestId('flow-primary');
        screen.pressByTestId('flow-primary');

        expect(onPress).toHaveBeenCalledTimes(1);
        deferred.resolve();
        await act(async () => deferred.promise);
    });
});
