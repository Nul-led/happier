import { describe, expect, it } from 'vitest';

import { lightTheme } from '@/theme';

import { resolveAgentInputPanelStyle } from './agentInputChromeStyles';

describe('agent input panel chrome', () => {
    it('rounds the composer panel with the theme composer radius', () => {
        const theme = { ...lightTheme, parts: { ...lightTheme.parts, composer: { radius: 37 } } };

        expect(resolveAgentInputPanelStyle(theme).borderRadius).toBe(37);
        expect(resolveAgentInputPanelStyle(lightTheme).borderRadius).toBe(lightTheme.parts.composer.radius);
    });
});
