import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { WorkflowBlockActionsMenu } from './WorkflowBlockActionsMenu';

const capturedPopoverProps = vi.hoisted(() => ({ current: [] as Record<string, unknown>[] }));
const portalOptions = vi.hoisted(() => ({
    web: true,
    native: true,
    matchAnchorWidth: false,
    anchorAlign: 'start',
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@/components/ui/icons/Icon', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    Icon: (props: Record<string, unknown>) => React.createElement('Icon', props),
}));
vi.mock('@/components/ui/popover/Popover', () => ({
    Popover: (props: Record<string, unknown>) => {
        capturedPopoverProps.current.push(props);
        return React.createElement('Popover');
    },
}));
vi.mock('@/components/ui/popover/modalAwareFloatingPopoverPortalOptions', () => ({
    MODAL_AWARE_FLOATING_POPOVER_PORTAL_OPTIONS: portalOptions,
}));

describe('workflow menu popover portal ownership', () => {
    it('mounts block actions in the modal-aware overlay host', async () => {
        await renderScreen(
            <WorkflowBlockActionsMenu
                blockLabel="Review"
                actions={[{ id: 'remove', label: 'Remove', onSelect: () => {} }]}
                testID="workflow-actions"
            />,
        );

        expect(capturedPopoverProps.current.at(-1)?.portal).toBe(portalOptions);
    });
});
