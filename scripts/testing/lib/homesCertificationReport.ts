import { HOMES_SCENARIO_FAMILY_MAP, type HomesScenarioId } from './homesScenarioInventory.ts';

export const HOMES_CERTIFICATION_SECTION_START = '<!-- lane09-homes-certification:start -->';
export const HOMES_CERTIFICATION_SECTION_END = '<!-- lane09-homes-certification:end -->';
export const HOMES_COMPLETION_MATRIX_START = '<!-- lane09-completion-matrix:start -->';
export const HOMES_COMPLETION_MATRIX_END = '<!-- lane09-completion-matrix:end -->';

export type HomesCertificationStatus = 'verified' | 'failed' | 'blocked' | 'not-run';

export type HomesCertificationTarget = Readonly<{
  repository: string;
  head: string;
  dirtyStatus: string;
  changedPathsManifest: string;
  processBuild: string;
  stackSession: string;
  planRevision: string;
}>;

export const HOMES_COMPLETION_VERTICALS = Object.freeze([
  'Auth/provenance',
  'Account Directory/Home enrollment',
  'Personal Home bootstrap',
  'Multi-Home runtime',
  'QR enrollment',
  'Iroh transport',
  'Personal Home operations',
  'Mutagen handoff/sync',
] as const);

export type HomesCompletionVertical = (typeof HOMES_COMPLETION_VERTICALS)[number];

export type HomesCompletionMatrixRow = Readonly<{
  canonicalOwner: string;
  productionCompositionRoot: string;
  productionCaller: string;
  positiveObservableTest: string;
  negativeBypassCheck: string;
  status: HomesCertificationStatus;
  evidence: string;
}>;

export type ParsedHomesCertificationReport = Readonly<{
  target: HomesCertificationTarget;
  statuses: ReadonlyMap<HomesScenarioId, HomesCertificationStatus>;
  requirementEvidence: ReadonlyMap<HomesScenarioId, string>;
  completionMatrix: ReadonlyMap<HomesCompletionVertical, HomesCompletionMatrixRow>;
}>;

export type HomesCertificationValidationOptions = Readonly<{
  expectedTarget?: HomesCertificationTarget;
  targetObserved?: boolean;
}>;

const REQUIRED_IDS = Object.freeze(
  HOMES_SCENARIO_FAMILY_MAP.flatMap((family) => family.requirementIds),
);
const REQUIRED_ID_SET = new Set<string>(REQUIRED_IDS);
const COMPLETION_VERTICAL_SET = new Set<string>(HOMES_COMPLETION_VERTICALS);
const STATUS_SET = new Set<HomesCertificationStatus>([
  'verified',
  'failed',
  'blocked',
  'not-run',
]);

function countOccurrences(value: string, needle: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = value.indexOf(needle, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function certificationSection(report: string): string {
  const startCount = countOccurrences(report, HOMES_CERTIFICATION_SECTION_START);
  const endCount = countOccurrences(report, HOMES_CERTIFICATION_SECTION_END);
  if (startCount !== 1 || endCount !== 1) {
    throw new Error('Lane 09 report must contain exactly one Homes certification section.');
  }
  const start = report.indexOf(HOMES_CERTIFICATION_SECTION_START)
    + HOMES_CERTIFICATION_SECTION_START.length;
  const end = report.indexOf(HOMES_CERTIFICATION_SECTION_END, start);
  if (end < start) {
    throw new Error('Lane 09 Homes certification section boundaries are out of order.');
  }
  return report.slice(start, end);
}

function readTargetField(section: string, label: string): string {
  const prefix = `${label}:`;
  const matchingLines = section
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix));
  const match = matchingLines.length === 1
    ? /^`([^`\n]+)`$/u.exec(matchingLines[0].slice(prefix.length).trim())
    : null;
  const value = match?.[1]?.trim() ?? '';
  if (!value) {
    throw new Error(`Lane 09 Homes certification report is missing or has ambiguous ${label.toLowerCase()}.`);
  }
  return value;
}

function parseTarget(section: string): HomesCertificationTarget {
  const repository = readTargetField(section, 'Target repository');
  const head = readTargetField(section, 'Target HEAD');
  if (!/^[0-9a-f]{40}$/u.test(head)) {
    throw new Error('Lane 09 Homes certification target HEAD must be a full lowercase Git object id.');
  }
  return {
    repository,
    head,
    dirtyStatus: readTargetField(section, 'Target dirty status'),
    changedPathsManifest: readTargetField(section, 'Target changed paths manifest'),
    processBuild: readTargetField(section, 'Target process/build'),
    stackSession: readTargetField(section, 'Target stack/session'),
    planRevision: readTargetField(section, 'Plan revision'),
  };
}

function boundedSection(reportSection: string, startMarker: string, endMarker: string, name: string): string {
  const startCount = countOccurrences(reportSection, startMarker);
  const endCount = countOccurrences(reportSection, endMarker);
  if (startCount !== 1 || endCount !== 1) {
    throw new Error(`Lane 09 report must contain exactly one ${name} section.`);
  }
  const start = reportSection.indexOf(startMarker) + startMarker.length;
  const end = reportSection.indexOf(endMarker, start);
  if (end < start) {
    throw new Error(`Lane 09 ${name} section boundaries are out of order.`);
  }
  return reportSection.slice(start, end);
}

function parseCompletionMatrix(
  certificationReportSection: string,
): ReadonlyMap<HomesCompletionVertical, HomesCompletionMatrixRow> {
  const section = boundedSection(
    certificationReportSection,
    HOMES_COMPLETION_MATRIX_START,
    HOMES_COMPLETION_MATRIX_END,
    'A3 completion matrix',
  );
  const rows = new Map<HomesCompletionVertical, HomesCompletionMatrixRow>();
  for (const rawLine of section.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 8) continue;
    const [
      vertical,
      canonicalOwner,
      productionCompositionRoot,
      productionCaller,
      positiveObservableTest,
      negativeBypassCheck,
      status,
      evidence,
    ] = cells;
    if (vertical === 'Vertical' || /^-+$/u.test(vertical)) continue;
    if (!COMPLETION_VERTICAL_SET.has(vertical)) {
      throw new Error(`Lane 09 Homes certification report has unknown completion matrix row: ${vertical}.`);
    }
    if (rows.has(vertical as HomesCompletionVertical)) {
      throw new Error(`Lane 09 Homes certification report has duplicate completion matrix row: ${vertical}.`);
    }
    if (!STATUS_SET.has(status as HomesCertificationStatus)) {
      throw new Error(`Lane 09 Homes certification report has invalid status "${status}" for completion matrix row ${vertical}.`);
    }
    if ([
      canonicalOwner,
      productionCompositionRoot,
      productionCaller,
      positiveObservableTest,
      negativeBypassCheck,
      evidence,
    ].some((cell) => cell.length === 0)) {
      throw new Error(`Lane 09 Homes certification report has incomplete completion matrix row: ${vertical}.`);
    }
    rows.set(vertical as HomesCompletionVertical, {
      canonicalOwner,
      productionCompositionRoot,
      productionCaller,
      positiveObservableTest,
      negativeBypassCheck,
      status: status as HomesCertificationStatus,
      evidence,
    });
  }
  for (const vertical of HOMES_COMPLETION_VERTICALS) {
    if (!rows.has(vertical)) {
      throw new Error(`Lane 09 Homes certification report is missing completion matrix row: ${vertical}.`);
    }
  }
  return rows;
}

function parseRequirementRows(section: string): Readonly<{
  statuses: ReadonlyMap<HomesScenarioId, HomesCertificationStatus>;
  evidence: ReadonlyMap<HomesScenarioId, string>;
}> {
  const statuses = new Map<HomesScenarioId, HomesCertificationStatus>();
  const evidence = new Map<HomesScenarioId, string>();
  for (const rawLine of section.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 3) continue;
    const [id, status, evidenceReference] = cells;
    if (id === 'Requirement' || /^-+$/u.test(id)) continue;
    if (!id.startsWith('F-')) continue;
    if (!REQUIRED_ID_SET.has(id)) {
      throw new Error(`Lane 09 Homes certification report has unknown requirement row: ${id}.`);
    }
    if (statuses.has(id as HomesScenarioId)) {
      throw new Error(`Lane 09 Homes certification report has duplicate requirement row: ${id}.`);
    }
    if (!STATUS_SET.has(status as HomesCertificationStatus)) {
      throw new Error(`Lane 09 Homes certification report has invalid status "${status}" for ${id}.`);
    }
    if (!evidenceReference) {
      throw new Error(`Lane 09 Homes certification report has missing evidence reference for ${id}.`);
    }
    statuses.set(id as HomesScenarioId, status as HomesCertificationStatus);
    evidence.set(id as HomesScenarioId, evidenceReference);
  }
  for (const id of REQUIRED_IDS) {
    if (!statuses.has(id)) {
      throw new Error(`Lane 09 Homes certification report is missing required row: ${id}.`);
    }
  }
  return { statuses, evidence };
}

/**
 * Parses target identity and row status from the sole Lane 09 Markdown evidence report.
 * Source owns only the stable requirement set; the report remains the only status authority.
 */
export function parseHomesCertificationReport(report: string): ParsedHomesCertificationReport {
  const section = certificationSection(report);
  const requirements = parseRequirementRows(section);
  return {
    target: parseTarget(section),
    statuses: requirements.statuses,
    requirementEvidence: requirements.evidence,
    completionMatrix: parseCompletionMatrix(section),
  };
}

export function isHomesCertificationTargetIdentityUnavailable(value: string): boolean {
  return /\b(?:not[- ]loaded|not[- ]captured|unavailable|unknown)\b|^none$/iu.test(value.trim());
}

export function deriveHomesCertificationStackObservation(
  snapshot: unknown,
  repository: string,
  stackName: string,
  expectedBuildSourceFingerprint: string,
): Readonly<{ observed: boolean; processBuild: string; stackSession: string }> {
  const unavailable = { observed: false, processBuild: 'not-loaded', stackSession: 'unavailable' } as const;
  const snapshotRecord = isRecord(snapshot) ? snapshot : null;
  const runtime = isRecord(snapshotRecord?.runtime) ? snapshotRecord.runtime : null;
  const components = isRecord(runtime?.components) ? runtime.components : null;
  const server = isRecord(components?.server) ? components.server : null;
  const health = isRecord(runtime?.health) ? runtime.health : null;
  const repo = isRecord(snapshotRecord?.repo) ? snapshotRecord.repo : null;
  const runningPid = Number(runtime?.runningPid ?? runtime?.ownerPid);
  const loadedSnapshotId = typeof runtime?.loadedSnapshotId === 'string'
    ? runtime.loadedSnapshotId.trim()
    : '';
  const selectedSnapshotId = typeof runtime?.selectedSnapshotId === 'string'
    ? runtime.selectedSnapshotId.trim()
    : '';
  const sourceFingerprint = typeof runtime?.sourceFingerprint === 'string'
    ? runtime.sourceFingerprint.trim()
    : '';
  const buildSourceFingerprint = typeof runtime?.buildSourceFingerprint === 'string'
    ? runtime.buildSourceFingerprint.trim()
    : '';
  const observed = runtime?.running === true
    && server?.running === true
    && health?.status === 'healthy'
    && runtime?.valid === true
    && Number.isInteger(runningPid)
    && runningPid > 1
    && repo?.dir === repository
    && runtime?.pendingManualRestart !== true
    && loadedSnapshotId.length > 0
    && selectedSnapshotId === loadedSnapshotId
    && sourceFingerprint.length > 0
    && buildSourceFingerprint.length > 0
    && buildSourceFingerprint === expectedBuildSourceFingerprint;
  return observed
    ? {
        observed: true,
        processBuild: `snapshot:${loadedSnapshotId}:${sourceFingerprint}`,
        stackSession: `${stackName}:${runningPid}`,
      }
    : unavailable;
}

/**
 * Checks whether a human-owned Lane 09 report is structurally complete and names the observed
 * current target. It does not read a second evidence schema, execute a scenario, or certify
 * product behavior; the human report links to the existing command logs and artifacts.
 */
export function validateHomesCertificationReport(
  report: string,
  options: HomesCertificationValidationOptions = {},
): Readonly<{
  reportComplete: boolean;
  unresolved: readonly Readonly<{ id: HomesScenarioId; status: Exclude<HomesCertificationStatus, 'verified'> }>[];
  matrixUnresolved: readonly Readonly<{
    vertical: HomesCompletionVertical;
    status: Exclude<HomesCertificationStatus, 'verified'>;
  }>[];
  targetIssues: readonly string[];
  evidenceIssues: readonly string[];
}> {
  const parsed = parseHomesCertificationReport(report);
  const unresolved = REQUIRED_IDS.flatMap((id) => {
    const status = parsed.statuses.get(id);
    if (status === 'verified') return [];
    if (status === undefined) throw new Error(`Lane 09 Homes certification report lost required row: ${id}.`);
    return [{ id, status }] as const;
  });
  const matrixUnresolved = HOMES_COMPLETION_VERTICALS.flatMap((vertical) => {
    const status = parsed.completionMatrix.get(vertical)?.status;
    if (status === 'verified') return [];
    if (status === undefined) {
      throw new Error(`Lane 09 Homes certification report lost completion matrix row: ${vertical}.`);
    }
    return [{ vertical, status }] as const;
  });
  const targetIssues: string[] = [];
  const evidenceIssues: string[] = [];
  if (isHomesCertificationTargetIdentityUnavailable(parsed.target.processBuild)) {
    targetIssues.push('Target must identify a loaded process/build.');
  }
  if (isHomesCertificationTargetIdentityUnavailable(parsed.target.stackSession)) {
    targetIssues.push('Target must identify an available stack/session.');
  }
  if (isHomesCertificationTargetIdentityUnavailable(parsed.target.changedPathsManifest)) {
    targetIssues.push('Target must identify a captured changed-paths manifest.');
  }
  if (options.targetObserved !== true) {
    targetIssues.push('Target process/build and stack/session must be observed through the canonical runtime owner.');
  }
  if (options.expectedTarget) {
    const fields = [
      ['repository', 'repository'],
      ['head', 'HEAD'],
      ['dirtyStatus', 'dirty status'],
      ['changedPathsManifest', 'changed paths manifest'],
      ['processBuild', 'process/build'],
      ['stackSession', 'stack/session'],
      ['planRevision', 'plan revision'],
    ] as const;
    for (const [field, label] of fields) {
      if (parsed.target[field] !== options.expectedTarget[field]) {
        targetIssues.push(`Report target ${label} does not match the current target.`);
      }
    }
  }
  for (const vertical of HOMES_COMPLETION_VERTICALS) {
    const row = parsed.completionMatrix.get(vertical);
    if (row?.status === 'verified' && row.positiveObservableTest === row.negativeBypassCheck) {
      evidenceIssues.push(`${vertical} must name distinct positive and negative observables.`);
    }
  }
  return {
    reportComplete: unresolved.length === 0
      && matrixUnresolved.length === 0
      && targetIssues.length === 0
      && evidenceIssues.length === 0,
    unresolved,
    matrixUnresolved,
    targetIssues,
    evidenceIssues,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
