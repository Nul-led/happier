import * as React from 'react';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { installPanelCommonModuleMocks } from '@/components/ui/panels/panelTestHelpers';
import { DocumentTabStrip } from './DocumentTabStrip';

installPanelCommonModuleMocks();

describe('DocumentTabStrip actions', () => {
    it('identifies each tab in its action names and preserves pin, unpin and unsaved close intent', async () => {
        const pin = vi.fn();
        const unpin = vi.fn();
        const close = vi.fn();
        const screen = await renderScreen(<DocumentTabStrip
            tabs={[
                { key: 'a', title: 'Alpha', isPinned: false, isPreview: true },
                { key: 'b', title: 'Beta', isPinned: true, isPreview: false },
            ]}
            activeTabKey="a" accessibilityLabel="Documents"
            onActivate={() => {}} onPin={pin} onUnpin={unpin} onClose={close}
            renderLeadingIcon={() => null} tabNativeId={(id) => `tab-${id}`} panelNativeId={(id) => `panel-${id}`}
            unsavedTabKeys={new Set(['b'])}
            testIds={{ tabPin: (id) => `pin-${id}`, tabUnpin: (id) => `unpin-${id}`, tabClose: (id) => `close-${id}` }}
        />);
        const pinButton = screen.findByTestId('pin-a');
        const unpinButton = screen.findByTestId('unpin-b');
        const closeButton = screen.findByTestId('close-b');
        expect(pinButton?.props.accessibilityLabel).toContain('Alpha');
        expect(unpinButton?.props.accessibilityLabel).toContain('Beta');
        expect(closeButton?.props.accessibilityLabel).toContain('Beta');
        expect(closeButton?.props.accessibilityLabel).toContain('closeUnsavedTabA11y');
        await act(async () => {
            pinButton?.props.onPress({ stopPropagation() {} });
            unpinButton?.props.onPress({ stopPropagation() {} });
            closeButton?.props.onPress({ stopPropagation() {} });
        });
        expect(pin).toHaveBeenCalledWith('a');
        expect(unpin).toHaveBeenCalledWith('b');
        expect(close).toHaveBeenCalledWith('b');
    });
});
