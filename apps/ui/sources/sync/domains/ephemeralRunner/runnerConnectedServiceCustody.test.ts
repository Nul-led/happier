import { describe, expect, it } from 'vitest';
import { resolveRunnerConnectedServiceReviewBindingsV1 } from './runnerConnectedServiceCustody';

describe('Runner Connected Service review admission', () => {
    it.each([
        { source: 'connected', selection: 'profile', profileId: 'work' },
        { source: 'connected', selection: 'group', groupId: 'work' },
        { source: 'team_resource', resourceId: 'resource-1', deliveryMode: 'brokered' },
    ] as const)('blocks $source before opening any Account credentials', async (selection) => {
        await expect(resolveRunnerConnectedServiceReviewBindingsV1({
            bindings: { v: 2, bindingsByServiceId: { 'acme.agent/cloud': selection } },
        })).rejects.toMatchObject({ code: 'runner_connected_service_not_portable', serviceKey: 'acme.agent/cloud' });
    });

    it('preserves endpoint-native selections without credential custody', async () => {
        await expect(resolveRunnerConnectedServiceReviewBindingsV1({
            bindings: { v: 2, bindingsByServiceId: { 'acme.agent/cloud': { source: 'native' } } },
        })).resolves.toEqual({ v: 1, bindings: [] });
    });

    it('honors cancellation', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(resolveRunnerConnectedServiceReviewBindingsV1({
            bindings: { v: 2, bindingsByServiceId: {} }, signal: controller.signal,
        })).rejects.toMatchObject({ name: 'AbortError' });
    });
});
