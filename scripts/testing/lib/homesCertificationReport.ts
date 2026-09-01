export const HOMES_CERTIFICATION_SECTION_START = '<!-- lane09-homes-certification:start -->';
export const HOMES_CERTIFICATION_SECTION_END = '<!-- lane09-homes-certification:end -->';
export const HOMES_A4_JOURNEYS_START = '<!-- lane09-a4-journeys:start -->';
export const HOMES_A4_JOURNEYS_END = '<!-- lane09-a4-journeys:end -->';

export type HomesCertificationStatus = 'verified' | 'failed' | 'blocked' | 'not-run';

export type HomesCertificationAuditBasis = Readonly<{
  repository: string;
  head: string;
  dirtyStatus: string;
  planRevision: string;
}>;

export const HOMES_A4_JOURNEYS = Object.freeze([
  'J09-01 Personal Home',
  'J09-02 Multi-Home',
  'J09-03 Account Service',
  'J09-04 Home approval',
  'J09-05 Direct QR',
  'J09-06 Reverse/Iroh QR',
  'J09-07 Home transport',
  'J09-08 Machine transfer',
  'J09-09 Home operations',
  'J09-10 Search',
  'J09-11 Workspace sync',
  'J09-12 Compatibility',
] as const);

export type HomesA4Journey = (typeof HOMES_A4_JOURNEYS)[number];

export type HomesA4JourneyRow = Readonly<{
  canonicalOwner: string;
  productionCompositionRoot: string;
  productionCaller: string;
  actualTargetRuntime: string;
  positiveResult: string;
  negativeBypassResult: string;
  accessibilityTechnicalDetailsEvidence: string;
  status: HomesCertificationStatus;
  commandArtifact: string;
  residualOwnerNextAction: string;
}>;

export type ParsedHomesCertificationReport = Readonly<{
  auditBasis: HomesCertificationAuditBasis;
  journeys: ReadonlyMap<HomesA4Journey, HomesA4JourneyRow>;
}>;

const A4_JOURNEY_SET = new Set<string>(HOMES_A4_JOURNEYS);
const STATUS_SET = new Set<HomesCertificationStatus>(['verified', 'failed', 'blocked', 'not-run']);

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

function boundedSection(report: string, startMarker: string, endMarker: string, name: string): string {
  if (countOccurrences(report, startMarker) !== 1 || countOccurrences(report, endMarker) !== 1) {
    throw new Error(`Lane 09 report must contain exactly one ${name} section.`);
  }
  const start = report.indexOf(startMarker) + startMarker.length;
  const end = report.indexOf(endMarker, start);
  if (end < start) throw new Error(`Lane 09 ${name} section boundaries are out of order.`);
  return report.slice(start, end);
}

function readAuditField(section: string, label: string): string {
  const prefix = `${label}:`;
  const lines = section.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.startsWith(prefix));
  const match = lines.length === 1 ? /^`([^`\n]+)`$/u.exec(lines[0].slice(prefix.length).trim()) : null;
  const value = match?.[1]?.trim() ?? '';
  if (!value) throw new Error(`Lane 09 report is missing or has ambiguous ${label.toLowerCase()}.`);
  return value;
}

function parseAuditBasis(section: string): HomesCertificationAuditBasis {
  const head = readAuditField(section, 'Audit HEAD');
  if (!/^[0-9a-f]{40}$/u.test(head)) throw new Error('Lane 09 audit HEAD must be a full lowercase Git object id.');
  return {
    repository: readAuditField(section, 'Audit repository'),
    head,
    dirtyStatus: readAuditField(section, 'Audit dirty status'),
    planRevision: readAuditField(section, 'Plan revision'),
  };
}

function parseA4Journeys(section: string): ReadonlyMap<HomesA4Journey, HomesA4JourneyRow> {
  const journeySection = boundedSection(section, HOMES_A4_JOURNEYS_START, HOMES_A4_JOURNEYS_END, 'A4 production journeys');
  const rows = new Map<HomesA4Journey, HomesA4JourneyRow>();
  for (const rawLine of journeySection.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 11) continue;
    const [journey, canonicalOwner, productionCompositionRoot, productionCaller, actualTargetRuntime,
      positiveResult, negativeBypassResult, accessibilityTechnicalDetailsEvidence, status,
      commandArtifact, residualOwnerNextAction] = cells;
    if (journey === 'Journey' || /^-+$/u.test(journey)) continue;
    if (!A4_JOURNEY_SET.has(journey)) throw new Error(`Lane 09 Homes certification report has unknown A4 journey row: ${journey}.`);
    if (rows.has(journey as HomesA4Journey)) throw new Error(`Lane 09 Homes certification report has duplicate A4 journey row: ${journey}.`);
    if (!STATUS_SET.has(status as HomesCertificationStatus)) throw new Error(`Lane 09 Homes certification report has invalid status "${status}" for A4 journey ${journey}.`);
    if ([canonicalOwner, productionCompositionRoot, productionCaller, actualTargetRuntime, positiveResult,
      negativeBypassResult, accessibilityTechnicalDetailsEvidence, commandArtifact,
      residualOwnerNextAction].some((cell) => cell.length === 0)) {
      throw new Error(`Lane 09 Homes certification report has incomplete A4 journey row: ${journey}.`);
    }
    rows.set(journey as HomesA4Journey, {
      canonicalOwner,
      productionCompositionRoot,
      productionCaller,
      actualTargetRuntime,
      positiveResult,
      negativeBypassResult,
      accessibilityTechnicalDetailsEvidence,
      status: status as HomesCertificationStatus,
      commandArtifact,
      residualOwnerNextAction,
    });
  }
  for (const journey of HOMES_A4_JOURNEYS) {
    if (!rows.has(journey)) throw new Error(`Lane 09 Homes certification report is missing A4 journey row: ${journey}.`);
  }
  return rows;
}

/** Parses the compact human report; only A4 journeys own mutable status. */
export function parseHomesCertificationReport(report: string): ParsedHomesCertificationReport {
  const section = boundedSection(report, HOMES_CERTIFICATION_SECTION_START, HOMES_CERTIFICATION_SECTION_END, 'Homes certification');
  return { auditBasis: parseAuditBasis(section), journeys: parseA4Journeys(section) };
}

/** Lints structure only. It does not execute commands, inspect artifacts, or certify behavior. */
export function validateHomesCertificationReportStructure(report: string): Readonly<{
  reportStructureValid: true;
  unresolvedJourneys: readonly Readonly<{
    journey: HomesA4Journey;
    status: Exclude<HomesCertificationStatus, 'verified'>;
  }>[];
}> {
  const parsed = parseHomesCertificationReport(report);
  const unresolvedJourneys = HOMES_A4_JOURNEYS.flatMap((journey) => {
    const status = parsed.journeys.get(journey)?.status;
    if (status === 'verified') return [];
    if (status === undefined) throw new Error(`Lane 09 report lost A4 journey row: ${journey}.`);
    return [{ journey, status }] as const;
  });
  return { reportStructureValid: true, unresolvedJourneys };
}
