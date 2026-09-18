import { describe, expect, it } from 'vitest';

import { createWorkosPortalReturnController } from './workosPortalReturn';

describe('WorkOS Admin Portal return', () => {
    it('requests one reconciliation after an opened portal regains focus', () => {
        const controller = createWorkosPortalReturnController();
        expect(controller.consumeReturn()).toBe(false);
        controller.markOpened();
        expect(controller.consumeReturn()).toBe(true);
        expect(controller.consumeReturn()).toBe(false);
    });
});
