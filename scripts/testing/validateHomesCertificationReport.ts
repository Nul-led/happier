import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseHomesCertificationReport,
  validateHomesCertificationReportStructure,
} from './lib/homesCertificationReport.ts';

function main(): void {
  const reportArgument = process.argv[2]?.trim();
  if (!reportArgument) {
    process.stderr.write(
      'Usage: node --experimental-strip-types scripts/testing/validateHomesCertificationReport.ts <report-path>\n',
    );
    process.exitCode = 1;
    return;
  }
  const reportPath = resolve(process.cwd(), reportArgument);
  const report = readFileSync(reportPath, 'utf8');
  const parsed = parseHomesCertificationReport(report);
  const result = validateHomesCertificationReportStructure(report);
  process.stdout.write([
    `Homes report structure check passed for ${parsed.journeys.size} A4 journeys (${reportPath}).`,
    ...result.unresolvedJourneys.map((row) => `- declared ${row.journey}: ${row.status}`),
    'This command checks report structure only; it does not execute or certify product behavior.',
    '',
  ].join('\n'));
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Homes report structure is invalid: ${message}\n`);
  process.exitCode = 1;
}
