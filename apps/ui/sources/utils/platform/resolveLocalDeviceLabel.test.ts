import { describe, expect, it } from 'vitest';

import { resolveLocalDeviceLabel } from './resolveLocalDeviceLabel';

describe('resolveLocalDeviceLabel', () => {
    it('preserves the actual device name and uses platform names only as a fallback', () => {
        expect(resolveLocalDeviceLabel({ deviceName: '  Alice’s Mac  ', platform: 'macos' })).toBe('Alice’s Mac');
        expect(resolveLocalDeviceLabel({ deviceName: null, platform: 'ios' })).toBe('iPhone');
        expect(resolveLocalDeviceLabel({ deviceName: '', platform: 'android' })).toBe('Android');
        expect(resolveLocalDeviceLabel({ deviceName: null, platform: 'web' })).toBeNull();
    });
});
