import { describe, expect, it } from 'vitest';

import { resolveMachineConnectionStatusKey } from './connectionHealthPresentation';

describe('resolveMachineConnectionStatusKey', () => {
    it.each([
        ['status.online', 'connected'],
        ['status.offline', 'disconnected'],
        ['newSession.noMachinesFound', 'action_required'],
        ['status.unknown', 'unknown'],
    ] as const)('keeps the machine status carrier aligned with %s', (labelKey, expected) => {
        expect(resolveMachineConnectionStatusKey(labelKey)).toBe(expected);
    });
});
