import assert from 'node:assert/strict';
import test from 'node:test';

import { HOMES_SCENARIO_FAMILY_MAP } from './homesScenarioInventory.ts';
import {
  deriveHomesCertificationStackObservation,
  parseHomesCertificationReport,
  validateHomesCertificationReport,
} from './homesCertificationReport.ts';

const requirementIds = HOMES_SCENARIO_FAMILY_MAP.flatMap((family) => family.requirementIds);
const completionVerticals = [
  'Auth/provenance',
  'Account Directory/Home enrollment',
  'Personal Home bootstrap',
  'Multi-Home runtime',
  'QR enrollment',
  'Iroh transport',
  'Personal Home operations',
  'Mutagen handoff/sync',
] as const;

type Status = 'verified' | 'failed' | 'blocked' | 'not-run';

const expectedTarget = {
  repository: '/workspace/0.3',
  head: 'a'.repeat(40),
  dirtyStatus: 'dirty: 3 entries',
  changedPathsManifest: '/tmp/lane09-changed-paths.txt',
  processBuild: 'desktop-build-20260831.1',
  stackSession: 'stack-03 / session-lane09',
  planRevision: 'A2 + A3 clarification bundle',
} as const;

function requirementEvidenceReference(id: string): string {
  return `/evidence/requirements/${id}.json`;
}

const verifiedValidationOptions = {
  expectedTarget,
  targetObserved: true,
} as const;

function reportWith(
  statuses: ReadonlyMap<string, Status>,
  options: Readonly<{
    includeIdentity?: boolean;
    loadedTarget?: boolean;
    completionStatuses?: ReadonlyMap<string, Status>;
  }> = {},
): string {
  const identity = options.includeIdentity === false
    ? ''
    : [
        `Target repository: \`${expectedTarget.repository}\``,
        `Target HEAD: \`${expectedTarget.head}\``,
        `Target dirty status: \`${expectedTarget.dirtyStatus}\``,
        `Target changed paths manifest: \`${expectedTarget.changedPathsManifest}\``,
        `Target process/build: \`${options.loadedTarget === false ? 'not-loaded' : expectedTarget.processBuild}\``,
        `Target stack/session: \`${options.loadedTarget === false ? 'unavailable' : expectedTarget.stackSession}\``,
        `Plan revision: \`${expectedTarget.planRevision}\``,
        '',
      ].join('\n');
  const rows = [...statuses]
    .map(([id, status]) => `| ${id} | ${status} | ${requirementEvidenceReference(id)} |`)
    .join('\n');
  const matrixStatuses = options.completionStatuses
    ?? new Map(completionVerticals.map((vertical) => [vertical, 'verified'] as const));
  const matrixRows = completionVerticals.map((vertical) => [
    vertical,
    `owner for ${vertical}`,
    `production root for ${vertical}`,
    `production caller for ${vertical}`,
    `positive current observable for ${vertical}`,
    `negative bypass for ${vertical}`,
    matrixStatuses.get(vertical) ?? 'not-run',
    `command/result/target references for ${vertical}`,
  ].map((cell) => ` ${cell} `).join('|')).map((row) => `|${row}|`).join('\n');
  return [
    '# report',
    '<!-- lane09-homes-certification:start -->',
    identity,
    '| Requirement | Status | Evidence manifest |',
    '| --- | --- | --- |',
    rows,
    '<!-- lane09-completion-matrix:start -->',
    '| Vertical | Canonical owner | Production composition root | Production caller | Positive observable test | Negative/bypass check | Status | Evidence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    matrixRows,
    '<!-- lane09-completion-matrix:end -->',
    '<!-- lane09-homes-certification:end -->',
  ].join('\n');
}

test('parses the sole report requirement table, target, and exact A3 completion matrix', () => {
  const statuses = new Map(requirementIds.map((id) => [id, 'verified'] as const));
  const parsed = parseHomesCertificationReport(reportWith(statuses));

  assert.deepEqual(parsed.target, expectedTarget);
  assert.equal(parsed.statuses.size, 41);
  assert.equal(parsed.statuses.get('F-IR-08 clientMachineTransfers'), 'verified');
  assert.equal(parsed.completionMatrix.size, 8);
  assert.equal(parsed.completionMatrix.get('Auth/provenance')?.status, 'verified');
  assert.match(parsed.completionMatrix.get('Iroh transport')?.productionCaller ?? '', /production caller/iu);
});

test('accepts a complete report only for exact-current loaded evidence with all rows verified', () => {
  const allVerified = new Map(requirementIds.map((id) => [id, 'verified'] as const));
  const completeReport = validateHomesCertificationReport(reportWith(allVerified), verifiedValidationOptions);
  assert.equal(Object.hasOwn(completeReport, 'certifiable'), false);
  assert.deepEqual(completeReport, {
    reportComplete: true,
    unresolved: [],
    matrixUnresolved: [],
    targetIssues: [],
    evidenceIssues: [],
  });

  const humanEvidence = validateHomesCertificationReport(reportWith(allVerified), {
    expectedTarget,
    targetObserved: true,
  });
  assert.equal(humanEvidence.reportComplete, true);

  const completionStatuses = new Map(completionVerticals.map((vertical) => [vertical, 'verified'] as const));
  completionStatuses.set('Iroh transport', 'failed');
  const matrixFailure = validateHomesCertificationReport(
    reportWith(allVerified, { completionStatuses }),
    verifiedValidationOptions,
  );
  assert.equal(matrixFailure.reportComplete, false);
  assert.deepEqual(matrixFailure.matrixUnresolved, [{ vertical: 'Iroh transport', status: 'failed' }]);

  const unloaded = validateHomesCertificationReport(
    reportWith(allVerified, { loadedTarget: false }),
    {
      ...verifiedValidationOptions,
      expectedTarget: { ...expectedTarget, processBuild: 'not-loaded', stackSession: 'unavailable' },
      targetObserved: false,
    },
  );
  assert.equal(unloaded.reportComplete, false);
  assert.match(unloaded.targetIssues.join('\n'), /loaded process\/build/iu);

  const wrongCurrentTarget = validateHomesCertificationReport(reportWith(allVerified), {
    ...verifiedValidationOptions,
    expectedTarget: { ...expectedTarget, head: 'b'.repeat(40) },
  });
  assert.equal(wrongCurrentTarget.reportComplete, false);
  assert.match(wrongCurrentTarget.targetIssues.join('\n'), /target HEAD/iu);
});

test('reports unresolved scenario rows in plan order', () => {
  const statuses = new Map(requirementIds.map((id) => [id, 'verified'] as const));
  statuses.set('F-PH-01 freshDesktopPersonalHome', 'failed');
  statuses.set('F-IR-03 standardOnly', 'blocked');
  statuses.set('F-MU-06 machineCarrier', 'not-run');
  assert.deepEqual(validateHomesCertificationReport(reportWith(statuses), { expectedTarget }).unresolved, [
    { id: 'F-PH-01 freshDesktopPersonalHome', status: 'failed' },
    { id: 'F-IR-03 standardOnly', status: 'blocked' },
    { id: 'F-MU-06 machineCarrier', status: 'not-run' },
  ]);
});

test('checks report structure and target identity without treating a second manifest schema as evidence', () => {
  const allVerified = new Map(requirementIds.map((id) => [id, 'verified'] as const));
  const duplicateObservables = reportWith(allVerified).replace(
    'negative bypass for Auth/provenance',
    'positive current observable for Auth/provenance',
  );
  const duplicateResult = validateHomesCertificationReport(
    duplicateObservables,
    verifiedValidationOptions,
  );
  assert.equal(duplicateResult.reportComplete, false);
  assert.match(duplicateResult.evidenceIssues.join('\n'), /distinct positive and negative/iu);
});

test('observes only a valid loaded snapshot, never a healthy source-mode process without byte identity', () => {
  const baseSnapshot = {
    repo: { dir: expectedTarget.repository },
    runtime: {
      running: true,
      runningPid: 4123,
      health: { status: 'healthy' },
      components: { server: { running: true } },
      pendingManualRestart: false,
      valid: true,
      selectedSnapshotId: 'snapshot-current',
      loadedSnapshotId: 'snapshot-current',
      sourceFingerprint: 'source-fingerprint-current',
      buildSourceFingerprint: 'checkout-source-fingerprint-current',
    },
  };
  assert.deepEqual(
    deriveHomesCertificationStackObservation(
      baseSnapshot,
      expectedTarget.repository,
      'stack-03',
      'checkout-source-fingerprint-current',
    ),
    {
      observed: true,
      processBuild: 'snapshot:snapshot-current:source-fingerprint-current',
      stackSession: 'stack-03:4123',
    },
  );
  assert.equal(
    deriveHomesCertificationStackObservation(
      { ...baseSnapshot, runtime: { ...baseSnapshot.runtime, loadedSnapshotId: null } },
      expectedTarget.repository,
      'stack-03',
      'checkout-source-fingerprint-current',
    ).observed,
    false,
  );
  assert.equal(
    deriveHomesCertificationStackObservation(
      { ...baseSnapshot, runtime: { ...baseSnapshot.runtime, selectedSnapshotId: 'snapshot-new' } },
      expectedTarget.repository,
      'stack-03',
      'checkout-source-fingerprint-current',
    ).observed,
    false,
  );
  assert.equal(
    deriveHomesCertificationStackObservation(
      baseSnapshot,
      expectedTarget.repository,
      'stack-03',
      'checkout-source-fingerprint-newer',
    ).observed,
    false,
  );
});

test('rejects missing, duplicate, unknown, and malformed requirement rows', () => {
  const statuses = new Map(requirementIds.map((id) => [id, 'verified'] as const));
  const complete = reportWith(statuses);

  assert.throws(
    () => parseHomesCertificationReport(complete.replace(
      `| F-PH-01 freshDesktopPersonalHome | verified | ${requirementEvidenceReference('F-PH-01 freshDesktopPersonalHome')} |\n`,
      '',
    )),
    /missing required row.*F-PH-01/iu,
  );
  assert.throws(
    () => parseHomesCertificationReport(complete.replace(
      `| F-PH-01 freshDesktopPersonalHome | verified | ${requirementEvidenceReference('F-PH-01 freshDesktopPersonalHome')} |`,
      `| F-PH-01 freshDesktopPersonalHome | verified | ${requirementEvidenceReference('F-PH-01 freshDesktopPersonalHome')} |\n| F-PH-01 freshDesktopPersonalHome | verified | ${requirementEvidenceReference('F-PH-01 freshDesktopPersonalHome')} |`,
    )),
    /duplicate requirement row.*F-PH-01/iu,
  );
  assert.throws(
    () => parseHomesCertificationReport(complete.replace(
      '<!-- lane09-completion-matrix:start -->',
      '| F-XX-01 invented | verified | /evidence/invented.json |\n<!-- lane09-completion-matrix:start -->',
    )),
    /unknown requirement row.*F-XX-01/iu,
  );
  assert.throws(
    () => parseHomesCertificationReport(complete.replace(
      `| F-PH-01 freshDesktopPersonalHome | verified | ${requirementEvidenceReference('F-PH-01 freshDesktopPersonalHome')} |`,
      `| F-PH-01 freshDesktopPersonalHome | green | ${requirementEvidenceReference('F-PH-01 freshDesktopPersonalHome')} |`,
    )),
    /invalid status.*green/iu,
  );
});

test('rejects missing, duplicate, unknown, malformed, or incomplete A3 completion rows', () => {
  const statuses = new Map(requirementIds.map((id) => [id, 'verified'] as const));
  const complete = reportWith(statuses);
  const authRow = complete.split('\n').find((line) => line.startsWith('| Auth/provenance |'))!;

  assert.throws(
    () => parseHomesCertificationReport(complete.replace(`${authRow}\n`, '')),
    /missing completion matrix row.*Auth\/provenance/iu,
  );
  assert.throws(
    () => parseHomesCertificationReport(complete.replace(authRow, `${authRow}\n${authRow}`)),
    /duplicate completion matrix row.*Auth\/provenance/iu,
  );
  assert.throws(
    () => parseHomesCertificationReport(complete.replace(
      '<!-- lane09-completion-matrix:end -->',
      '| Invented vertical | owner | root | caller | positive | negative | verified | evidence |\n<!-- lane09-completion-matrix:end -->',
    )),
    /unknown completion matrix row.*Invented vertical/iu,
  );
  assert.throws(
    () => parseHomesCertificationReport(complete.replace('production caller for Auth/provenance', '')),
    /incomplete completion matrix row.*Auth\/provenance/iu,
  );
});

test('rejects missing or ambiguous report boundaries and incomplete target identity', () => {
  const statuses = new Map(requirementIds.map((id) => [id, 'verified'] as const));
  const complete = reportWith(statuses);

  assert.throws(
    () => parseHomesCertificationReport(complete.replace(`Target process/build: \`${expectedTarget.processBuild}\`\n`, '')),
    /target process\/build/iu,
  );
  assert.throws(
    () => parseHomesCertificationReport(`${complete}\n${complete}`),
    /exactly one.*certification section/iu,
  );
  assert.throws(
    () => parseHomesCertificationReport(reportWith(statuses, { includeIdentity: false })),
    /target repository/iu,
  );
});
