import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { installPanelCommonModuleMocks } from './panelTestHelpers';
import { PaneLoadingFallback } from './PaneLoadingFallback';
import { SurfaceStateSizeProvider } from '@/components/ui/surfaces/surfaceStateSize';

installPanelCommonModuleMocks();

describe('PaneLoadingFallback', () => {
    it('announces pending content through one status region at the container-selected size', async () => {
        const screen = await renderScreen(<SurfaceStateSizeProvider size="phone">
            <PaneLoadingFallback testID="pending-pane" />
        </SurfaceStateSizeProvider>);
        expect(screen.findHostByTestId('pending-pane')?.props.accessibilityLiveRegion).toBe('polite');
        expect(screen.findAll((node) => typeof node.type === 'string' && node.props.role === 'status')).toHaveLength(1);
        expect(screen.getTextContent()).toContain('common.loading');
    });
});
