import { describe, expect, it, vi } from 'vitest';

vi.mock('@/text', () => ({ t: (key: string) => key }));

import { describeTemporaryComputerLaunchBlock } from './temporaryComputerCopy';

describe('Temporary computer launch copy', () => {
    it.each([
        ['authoring_connectedServices_unsupported', 'connectedServices.title', 'newSession.connectedServicesReasonNotPortable'],
    ] as const)('names the exact selected field for %s', (block, label, reason) => {
        expect(describeTemporaryComputerLaunchBlock(block)).toBe(`${label}: ${reason}`);
    });
});
