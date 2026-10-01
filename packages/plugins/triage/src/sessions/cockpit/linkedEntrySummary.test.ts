import { describe, expect, it } from 'vitest';
import type { TriagePullRequestStatusV1 } from '@happier-dev/triage-protocol/v1';
import type { TriageListRowV1 } from '../../projection/listWindow.js';
import { testkitObservation, testkitEntryRef } from '../../corpus/testkit/observations.test-support.js';
import { projectTriageSessionLinkedEntrySummary, applyTriageSessionPullRequestStatus } from './linkedEntrySummary.js';

describe('source-declared session entry summaries', () => {
    it('recognizes a PR through its declared workflow subject rather than a forge kind-id spelling', () => {
        const observation = testkitObservation();
        if (observation.outcome.kind !== 'present') throw new Error('Expected a present fixture');
        const row: TriageListRowV1 = {
            entryRef: testkitEntryRef({ kindId: 'merge-request' }),
            content: { ...observation, outcome: observation.outcome },
            lane: '1-open', sortAtMs: observation.observedAtMs,
            presence: { kind: 'present', observedAtMs: observation.observedAtMs }, attention: null,
            selected: { kind: 'selected', sourceInstanceId: observation.sourceInstanceId, reason: 'onlyPresent' },
            observations: [observation],
        };
        expect(projectTriageSessionLinkedEntrySummary(row, 'pullRequest')).toMatchObject({
            kind: 'pullRequest', title: observation.outcome.snapshot.title,
            sourceInstanceId: observation.sourceInstanceId,
        });
        const entry = projectTriageSessionLinkedEntrySummary(row, 'pullRequest')!;
        const status: TriagePullRequestStatusV1 = { kind: 'status', observedAtMs: 1000,
            checks: { state: 'incomplete', passed: 9, failed: 1, pending: 0, total: 10, incomplete: true,
                rows: [{ id: 'web', name: 'ui-tests (web)', state: 'failed' }] },
            review: { decision: 'changesRequested', reviewers: [], incomplete: false }, merge: null, branch: null, facts: [] };
        expect(applyTriageSessionPullRequestStatus(entry, status)).toMatchObject({
            checks: { passed: 9, failed: 1, total: 10, firstFailingName: 'ui-tests (web)' },
            review: { decision: 'changesRequested' },
        });
        expect(applyTriageSessionPullRequestStatus(entry, { ...status,
            checks: { ...status.checks!, passed: null, failed: null, pending: null, total: null },
            review: { ...status.review!, decision: null },
        })).toMatchObject({ checks: null, review: null });
    });
});
