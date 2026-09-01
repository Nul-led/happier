import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOMES_A4_JOURNEYS,
  parseHomesCertificationReport,
  validateHomesCertificationReportStructure,
} from './homesCertificationReport.ts';

type Status = 'verified' | 'failed' | 'blocked' | 'not-run';

const auditBasis = {
  repository: '/workspace/0.3',
  head: 'a'.repeat(40),
  dirtyStatus: 'dirty: 3 entries',
  planRevision: 'A4',
} as const;

function reportWith(statuses: ReadonlyMap<string, Status>, includeBasis = true): string {
  const basis = includeBasis ? [
    `Audit repository: \`${auditBasis.repository}\``,
    `Audit HEAD: \`${auditBasis.head}\``,
    `Audit dirty status: \`${auditBasis.dirtyStatus}\``,
    `Plan revision: \`${auditBasis.planRevision}\``,
    '',
  ].join('\n') : '';
  const rows = HOMES_A4_JOURNEYS.map((journey) => [
    journey,
    `owner for ${journey}`,
    `production root for ${journey}`,
    `production caller for ${journey}`,
    `actual target for ${journey}`,
    `positive result for ${journey}`,
    `negative bypass for ${journey}`,
    `accessibility or technical-details evidence for ${journey}`,
    statuses.get(journey) ?? 'not-run',
    `command or artifact for ${journey}`,
    `residual owner and next action for ${journey}`,
  ].map((cell) => ` ${cell} `).join('|')).map((row) => `|${row}|`).join('\n');
  return [
    '# report',
    '<!-- lane09-homes-certification:start -->',
    basis,
    '<!-- lane09-a4-journeys:start -->',
    '| Journey | Canonical owner | Production composition root | Production caller | Actual target/runtime | Positive result | Negative/bypass result | Accessibility/technical-details evidence | Status | Command/artifact | Residual owner/next action |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    rows,
    '<!-- lane09-a4-journeys:end -->',
    '<!-- lane09-homes-certification:end -->',
  ].join('\n');
}

test('parses only the A4 journey statuses and per-journey evidence', () => {
  const statuses = new Map(HOMES_A4_JOURNEYS.map((journey) => [journey, 'not-run'] as const));
  statuses.set('J09-05 Direct QR', 'verified');
  const parsed = parseHomesCertificationReport(reportWith(statuses));

  assert.deepEqual(parsed.auditBasis, auditBasis);
  assert.equal(parsed.journeys.size, 12);
  assert.equal(parsed.journeys.get('J09-05 Direct QR')?.status, 'verified');
  assert.match(parsed.journeys.get('J09-05 Direct QR')?.actualTargetRuntime ?? '', /actual target/iu);
  assert.equal(Object.hasOwn(parsed, 'statuses'), false);
  assert.equal(Object.hasOwn(parsed, 'completionMatrix'), false);
});

test('structure lint reports unresolved journeys without claiming behavioral completion', () => {
  const statuses = new Map(HOMES_A4_JOURNEYS.map((journey) => [journey, 'verified'] as const));
  statuses.set('J09-02 Multi-Home', 'failed');
  statuses.set('J09-12 Compatibility', 'not-run');
  assert.deepEqual(validateHomesCertificationReportStructure(reportWith(statuses)), {
    reportStructureValid: true,
    unresolvedJourneys: [
      { journey: 'J09-02 Multi-Home', status: 'failed' },
      { journey: 'J09-12 Compatibility', status: 'not-run' },
    ],
  });
});

test('structure lint cannot become a behavioral oracle from verified prose', () => {
  const statuses = new Map(HOMES_A4_JOURNEYS.map((journey) => [journey, 'verified'] as const));
  const result = validateHomesCertificationReportStructure(reportWith(statuses).replace(
    'positive result for J09-01 Personal Home',
    'Not observed',
  ));
  assert.deepEqual(result, { reportStructureValid: true, unresolvedJourneys: [] });
  assert.equal(Object.hasOwn(result, 'reportComplete'), false);
  assert.equal(Object.hasOwn(result, 'certifiable'), false);
});

test('requires every known journey exactly once with the four-state vocabulary', () => {
  const statuses = new Map(HOMES_A4_JOURNEYS.map((journey) => [journey, 'not-run'] as const));
  const complete = reportWith(statuses);
  const directQrRow = complete.split('\n').find((line) => line.startsWith('| J09-05 Direct QR |'))!;
  assert.throws(() => parseHomesCertificationReport(complete.replace(`${directQrRow}\n`, '')), /missing A4 journey row.*J09-05/iu);
  assert.throws(() => parseHomesCertificationReport(complete.replace(directQrRow, `${directQrRow}\n${directQrRow}`)), /duplicate A4 journey row.*J09-05/iu);
  assert.throws(() => parseHomesCertificationReport(complete.replace('| J09-05 Direct QR |', '| J09-99 Invented |')), /unknown A4 journey row.*J09-99/iu);
  assert.throws(() => parseHomesCertificationReport(complete.replace(
    ' | not-run | command or artifact for J09-05 Direct QR |',
    ' | green | command or artifact for J09-05 Direct QR |',
  )), /invalid status.*green/iu);
});

test('requires one bounded report section and concise advisory audit basis', () => {
  const statuses = new Map(HOMES_A4_JOURNEYS.map((journey) => [journey, 'not-run'] as const));
  const complete = reportWith(statuses);
  assert.throws(() => parseHomesCertificationReport(`${complete}\n${complete}`), /exactly one.*certification section/iu);
  assert.throws(() => parseHomesCertificationReport(reportWith(statuses, false)), /audit (?:head|repository)/iu);
  assert.throws(() => parseHomesCertificationReport(complete.replace(`Audit HEAD: \`${auditBasis.head}\``, 'Audit HEAD: `short`')), /full lowercase Git object id/iu);
});
