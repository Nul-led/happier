import { describe, expect, it } from 'vitest';

import { createWorkflowInvocationIndexFixture } from '@/dev/testkit/fixtures/workflowRunFixtures';

import { mergeRefreshedInvocationFilterSpan } from './workflowRuns';

function attentionRow(id: string, sequence: string) {
    return createWorkflowInvocationIndexFixture({
        id,
        sequence,
        lifecycle: 'waiting_for_approval',
    });
}

describe('attention filtered-span refresh truth', () => {
    it('drops a settled tail row across the loaded span when the refreshed span is complete', () => {
        const existing = [
            attentionRow('inv-a', '0'),
            attentionRow('inv-b', '1'),
            attentionRow('inv-tail', '2'),
        ];
        const refreshed = [
            attentionRow('inv-a', '0'),
            attentionRow('inv-b', '1'),
        ];
        // The refreshed span exhausted the filter (cursor null): it is the
        // complete truth, so the settled tail must go even though it sorts
        // beyond the refreshed boundary.
        const merged = mergeRefreshedInvocationFilterSpan(existing, refreshed, null);
        expect(merged.map((entry) => entry.id)).toEqual(['inv-a', 'inv-b']);
    });

    it('merges an addition inside the loaded span while keeping the continuation for beyond', () => {
        const existing = [
            attentionRow('inv-a', '0'),
            attentionRow('inv-b', '1'),
        ];
        const refreshed = [
            attentionRow('inv-a', '0'),
            attentionRow('inv-new', '1'),
            attentionRow('inv-b', '2'),
        ];
        const merged = mergeRefreshedInvocationFilterSpan(existing, refreshed, 'cursor-more');
        expect(merged.map((entry) => entry.id)).toEqual(['inv-a', 'inv-new', 'inv-b']);
    });

    it('keeps a beyond-span tail only while the refreshed span still has more', () => {
        const existing = [
            attentionRow('inv-a', '0'),
            attentionRow('inv-b', '1'),
            attentionRow('inv-far', '9'),
        ];
        const refreshed = [
            attentionRow('inv-a', '0'),
            attentionRow('inv-b', '1'),
        ];
        const merged = mergeRefreshedInvocationFilterSpan(existing, refreshed, 'cursor-more');
        expect(merged.map((entry) => entry.id)).toEqual(['inv-a', 'inv-b', 'inv-far']);
    });
});
