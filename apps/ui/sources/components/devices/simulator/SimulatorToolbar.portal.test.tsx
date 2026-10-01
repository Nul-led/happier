import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { SimulatorToolbar as SimulatorToolbarImpl } from './SimulatorToolbar';

const capturedPopoverProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const portalOptions = vi.hoisted(() => ({
    web: true,
    native: true,
    matchAnchorWidth: false,
    anchorAlign: 'start',
}));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

vi.mock('@/components/ui/popover', () => ({
    MODAL_AWARE_FLOATING_POPOVER_PORTAL_OPTIONS: portalOptions,
    Popover: (props: Record<string, unknown>) => {
        capturedPopoverProps.current = props;
        return React.createElement('Popover');
    },
}));

describe('SimulatorToolbar popover portal ownership', () => {
    it('mounts the overflow menu in the modal-aware overlay host', async () => {
        await renderScreen(
            <SimulatorToolbarImpl
                viewModel={{
                    kind: 'selected',
                    lease: { state: 'held-by-me' },
                    controls: {
                        canWatch: true,
                        canControl: true,
                        canRequestKeyframe: false,
                        canRequestSnapshot: false,
                        canSetQuality: false,
                        canSetFps: false,
                        canSetScale: false,
                        supportedInputKinds: ['orientation'],
                    },
                } as unknown as React.ComponentProps<typeof SimulatorToolbarImpl>['viewModel']}
                actions={{}}
                testID="simulator-toolbar"
            />,
        );

        expect(capturedPopoverProps.current?.portal).toBe(portalOptions);
    });
});
