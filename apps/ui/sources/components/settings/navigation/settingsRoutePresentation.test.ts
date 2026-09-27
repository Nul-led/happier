import { describe, expect, it } from 'vitest';

import {
    resolveSettingsRouteAnimation,
    resolveSettingsRoutePresentation,
    resolveSettingsRouteWebModalStyle,
} from './settingsRoutePresentation';

describe('resolveSettingsRoutePresentation', () => {
    it('keeps settings as a full-screen screen on phones (reached via the bottom tab bar)', () => {
        // Phones surface settings through the bottom tab bar; the nav sidebar is hidden
        // at this size (window min-edge < 600px → deviceType === 'phone'), so the route
        // must stay a plain screen rather than a modal.
        expect(resolveSettingsRoutePresentation({ deviceType: 'phone', platformOs: 'ios' })).toBeUndefined();
        expect(resolveSettingsRoutePresentation({ deviceType: 'phone', platformOs: 'web' })).toBeUndefined();
        expect(resolveSettingsRoutePresentation({ deviceType: 'phone', platformOs: 'android' })).toBeUndefined();
    });

    it('presents settings as a contained modal on iOS tablets', () => {
        expect(resolveSettingsRoutePresentation({ deviceType: 'tablet', platformOs: 'ios' })).toBe('containedModal');
    });

    it('presents settings as a stack modal on web and android tablet/desktop layouts', () => {
        expect(resolveSettingsRoutePresentation({ deviceType: 'tablet', platformOs: 'web' })).toBe('modal');
        expect(resolveSettingsRoutePresentation({ deviceType: 'tablet', platformOs: 'android' })).toBe('modal');
    });
});

describe('resolveSettingsRouteAnimation', () => {
    it('suppresses the animation on phones so the settings tab switches instantly', () => {
        expect(resolveSettingsRouteAnimation({ deviceType: 'phone' })).toBe('none');
    });

    it('inherits the default modal animation on tablet/desktop (modal mode only)', () => {
        // `undefined` means "use the platform default modal animation"; crucially it is NOT
        // 'none', so the modal animates in while the phone tab still does not.
        expect(resolveSettingsRouteAnimation({ deviceType: 'tablet' })).toBeUndefined();
    });
});

describe('resolveSettingsRouteWebModalStyle', () => {
    it('gives the desktop web settings modal one fixed height, so it never resizes with its content', () => {
        // Route modals size to their content by default; settings content (search results, a short
        // page) changes as you use it, so the card would jump. A fixed height is its own min and max.
        const style = resolveSettingsRouteWebModalStyle({ deviceType: 'tablet', platformOs: 'web' });
        expect(style?.height).toBe('var(--happier-route-modal-max-height)');
        expect(style?.width).toEqual(expect.any(String));
    });

    it('leaves phones and native platforms without a web modal style', () => {
        expect(resolveSettingsRouteWebModalStyle({ deviceType: 'phone', platformOs: 'web' })).toBeUndefined();
        expect(resolveSettingsRouteWebModalStyle({ deviceType: 'tablet', platformOs: 'ios' })).toBeUndefined();
    });
});
