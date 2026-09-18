import { describe, expect, it, vi } from 'vitest';

import { formatIrohRelayConfiguration } from './formatIrohRelayConfiguration';

vi.mock('@/text', () => ({
    t: (key: string, params?: Readonly<Record<string, unknown>>) => params
        ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(',')})`
        : key,
}));

describe('formatIrohRelayConfiguration', () => {
    it('shows a known empty automatic relay list as zero shown out of zero', () => {
        expect(formatIrohRelayConfiguration({
            policy: 'automatic',
            relayUrls: [],
            relayUrlCount: 0,
            directAddressCount: 1,
        })).toBe(
            'connectionStatus.values.relayAutomatic(relays=connectionStatus.values.relayNone (0/0),direct=1)',
        );
    });

    it('keeps the direct-address count visible when relays are disabled', () => {
        expect(formatIrohRelayConfiguration({
            policy: 'disabled',
            relayUrls: [],
            directAddressCount: 2,
        })).toBe('connectionStatus.values.relayDisabledWithDirect(direct=2)');
    });

    it('reports the shown and total relay counts without treating truncation as unknown', () => {
        expect(formatIrohRelayConfiguration({
            policy: 'automatic',
            relayUrls: ['https://relay.example.test'],
            relayUrlCount: 3,
            relayUrlsTruncated: true,
            directAddressCount: 0,
        })).toBe(
            'connectionStatus.values.relayAutomatic(relays=https://relay.example.test (1/3),direct=0)',
        );
    });
});
