import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildSessionDetailAccessProjectionQuery } from './sessionDetailAccessProjection';

const getCachedServerFeaturesSnapshot = vi.hoisted(() => vi.fn());

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getCachedServerFeaturesSnapshot,
}));

describe('sessionDetailAccessProjection', () => {
    afterEach(() => {
        getCachedServerFeaturesSnapshot.mockReset();
    });

    it('keeps released bare detail when the exact Home decision is absent', () => {
        getCachedServerFeaturesSnapshot.mockReturnValue(null);

        expect(buildSessionDetailAccessProjectionQuery('home-legacy')).toBe('');
        expect(getCachedServerFeaturesSnapshot).toHaveBeenCalledWith({
            serverId: 'home-legacy',
        });
    });

    it('opts into effective detail access for an enabled exact Home decision', () => {
        getCachedServerFeaturesSnapshot.mockReturnValue({
            status: 'ready',
            features: {
                features: {
                    sessions: {
                        enabled: true,
                        collaboration: { enabled: true },
                    },
                    sharing: {
                        session: { enabled: true },
                    },
                },
            },
        });
        expect(buildSessionDetailAccessProjectionQuery('home-current')).toBe(
            '?accessProjectionVersion=1',
        );
        expect(getCachedServerFeaturesSnapshot).toHaveBeenCalledWith({
            serverId: 'home-current',
        });
    });
});
