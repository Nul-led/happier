import { describe, expect, it } from 'vitest';

import {
    MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR,
    MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR,
} from './machineCarrierHttpLease';

describe('machine carrier transfer error presentation', () => {
    it('states that the required machine connection is unavailable without implying fallback', () => {
        expect(MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR).toBe(
            'A direct machine connection is required for this transfer.',
        );
        expect(MACHINE_CARRIER_REQUIRED_TRANSFER_ERROR).not.toMatch(/fallback|user socket|server relay/i);
    });

    it('keeps an interrupted required carrier actionable without suggesting another route', () => {
        expect(MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR).toBe(
            'The direct machine connection was interrupted. Retry the transfer.',
        );
        expect(MACHINE_CARRIER_INTERRUPTED_TRANSFER_ERROR).not.toMatch(/fallback|user socket|server relay/i);
    });
});
