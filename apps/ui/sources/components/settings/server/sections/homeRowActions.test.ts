import { describe, expect, it } from 'vitest';

import { resolveCurrentHomeAttention, resolveHomeRowActions } from './homeRowActions';

const saved = { isCurrent: false, isDeviceDefault: false, isWeb: false, routineScope: 'device' } as const;

describe('resolveHomeRowActions', () => {
    it('offers the one action a saved Home needs for its real connection state', () => {
        expect(resolveHomeRowActions({ ...saved, summaryKind: 'connected' }).primary).toBe('switch');
        expect(resolveHomeRowActions({ ...saved, summaryKind: 'sign_in' }).primary).toBe('signIn');
        expect(resolveHomeRowActions({ ...saved, summaryKind: 'unavailable' }).primary).toBe('retry');
        // Unknown or still-reconnecting Homes can still be opened; switching is how to find out.
        expect(resolveHomeRowActions({ ...saved, summaryKind: 'reconnecting' }).primary).toBe('switch');
        expect(resolveHomeRowActions({ ...saved, summaryKind: 'unknown' }).primary).toBe('switch');
    });

    it('offers no row action on the current Home; its state action is the page banner', () => {
        for (const summaryKind of ['connected', 'sign_in', 'unavailable'] as const) {
            expect(resolveHomeRowActions({ ...saved, isCurrent: true, isDeviceDefault: true, summaryKind }).primary).toBeNull();
        }
    });

    it('keeps switching reachable from the menu when the row offers Sign in or Retry', () => {
        expect(resolveHomeRowActions({ ...saved, summaryKind: 'connected' }).menu).toEqual(['rename', 'remove']);
        expect(resolveHomeRowActions({ ...saved, summaryKind: 'sign_in' }).menu).toEqual(['switch', 'rename', 'remove']);
        expect(resolveHomeRowActions({ ...saved, isCurrent: true, isDeviceDefault: true, summaryKind: 'connected' }).menu)
            .toEqual(['rename', 'remove']);
    });

    it('in a browser tab, switches the tab and offers making a Home this device’s default from the menu', () => {
        const web = { ...saved, isWeb: true, routineScope: 'tab' } as const;
        expect(resolveHomeRowActions({ ...web, summaryKind: 'connected' }))
            .toEqual({ primary: 'switch', menu: ['switch-device', 'rename', 'remove'] });
        // The Home this tab uses can still become the device default.
        expect(resolveHomeRowActions({ ...web, isCurrent: true, summaryKind: 'connected' }).menu)
            .toEqual(['switch-device', 'rename', 'remove']);
        expect(resolveHomeRowActions({ ...web, isCurrent: true, isDeviceDefault: true, summaryKind: 'connected' }).menu)
            .toEqual(['rename', 'remove']);
    });

    it('on the desktop web host, switches the device and keeps switching only this window in the menu', () => {
        const desktop = { ...saved, isWeb: true, routineScope: 'device' } as const;
        expect(resolveHomeRowActions({ ...desktop, summaryKind: 'connected' }))
            .toEqual({ primary: 'switch', menu: ['switch-tab', 'rename', 'remove'] });
    });
});

describe('resolveCurrentHomeAttention', () => {
    it('asks for sign-in or a retry only when the current Home needs one', () => {
        expect(resolveCurrentHomeAttention({ kind: 'sign_in', action: 'restore' })).toBe('signIn');
        expect(resolveCurrentHomeAttention({ kind: 'unavailable', action: 'retry' })).toBe('retry');
        expect(resolveCurrentHomeAttention({ kind: 'unavailable', action: 'none' })).toBe('unavailable');
        expect(resolveCurrentHomeAttention({ kind: 'connected', action: 'none' })).toBeNull();
        expect(resolveCurrentHomeAttention({ kind: 'reconnecting', action: 'retry' })).toBeNull();
    });
});
