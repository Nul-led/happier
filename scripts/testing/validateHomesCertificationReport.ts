import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import {
  deriveHomesCertificationStackObservation,
  isHomesCertificationTargetIdentityUnavailable,
  parseHomesCertificationReport,
  validateHomesCertificationReport,
} from './lib/homesCertificationReport.ts';

const PLAN_REVISION = 'A2 + A3 clarification bundle';

function runGit(repository: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trimEnd();
}

function dirtyStatus(status: string): string {
  const entries = status ? status.split(/\r?\n/u).length : 0;
  return entries === 0 ? 'clean' : `dirty: ${entries} entries`;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

async function observeStackTarget(repository: string): Promise<Readonly<{
  observed: boolean;
  processBuild: string;
  stackSession: string;
}>> {
  const stackName = process.env.HAPPIER_HOMES_CERTIFICATION_STACK_NAME?.trim();
  if (!stackName) {
    return { observed: false, processBuild: 'not-loaded', stackSession: 'unavailable' };
  }
  // The Stack snapshot module is JavaScript-owned; narrow its untyped export at this boundary.
  const stackModule: unknown = await import('../apps/stack/scripts/stack/stack_info_snapshot.mjs');
  const stackExports = record(stackModule);
  const readSnapshot = stackExports?.readStackInfoSnapshot;
  if (typeof readSnapshot !== 'function') {
    throw new Error('Canonical Stack runtime observation owner is unavailable');
  }
  // Build-source collection is also JavaScript-owned; it is the canonical owner of
  // the dirty-checkout fingerprint embedded into runtime snapshot manifests.
  const sourceModule: unknown = await import('../apps/stack/scripts/build/collect_build_source_metadata.mjs');
  const sourceExports = record(sourceModule);
  const collectSourceMetadata = sourceExports?.collectBuildSourceMetadata;
  if (typeof collectSourceMetadata !== 'function') {
    throw new Error('Canonical Stack build-source identity owner is unavailable');
  }
  const sourceMetadata: unknown = await collectSourceMetadata({ rootDir: repository });
  const currentSourceFingerprint = record(sourceMetadata)?.sourceFingerprint;
  if (typeof currentSourceFingerprint !== 'string' || !currentSourceFingerprint.trim()) {
    throw new Error('Canonical Stack build-source identity is unavailable');
  }
  const snapshot: unknown = await readSnapshot({ rootDir: repository, stackName });
  return deriveHomesCertificationStackObservation(
    snapshot,
    repository,
    stackName,
    currentSourceFingerprint.trim(),
  );
}

async function main(): Promise<void> {
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
  const repository = realpathSync(runGit(process.cwd(), ['rev-parse', '--show-toplevel']));
  const status = runGit(repository, ['status', '--short', '--untracked-files=all']);
  const observedStack = await observeStackTarget(repository);
  const manifest = isHomesCertificationTargetIdentityUnavailable(parsed.target.changedPathsManifest)
    ? null
    : readFileSync(
        isAbsolute(parsed.target.changedPathsManifest)
          ? parsed.target.changedPathsManifest
          : resolve(repository, parsed.target.changedPathsManifest),
        'utf8',
      ).trimEnd();
  const validation = validateHomesCertificationReport(report, {
    expectedTarget: {
      repository,
      head: runGit(repository, ['rev-parse', 'HEAD']),
      dirtyStatus: dirtyStatus(status),
      changedPathsManifest: parsed.target.changedPathsManifest,
      processBuild: observedStack.processBuild,
      stackSession: observedStack.stackSession,
      planRevision: PLAN_REVISION,
    },
    targetObserved: observedStack.observed,
  });
  const targetIssues = manifest === null || manifest === status
    ? validation.targetIssues
    : [...validation.targetIssues, 'Target changed-paths manifest does not match the current working tree.'];
  const result = {
    ...validation,
    reportComplete: validation.reportComplete && targetIssues.length === 0,
    targetIssues,
  };
  if (!result.reportComplete) {
    process.stderr.write([
      `Homes evidence report is incomplete for ${parsed.target.head} (${reportPath}).`,
      ...result.unresolved.map((row) => `- ${row.id}: ${row.status}`),
      ...result.matrixUnresolved.map((row) => `- ${row.vertical}: ${row.status}`),
      ...result.targetIssues.map((issue) => `- target: ${issue}`),
      ...result.evidenceIssues.map((issue) => `- evidence: ${issue}`),
      '',
    ].join('\n'));
    process.exitCode = 1;
  } else {
    process.stdout.write([
      `Homes evidence report completeness check passed for all ${parsed.statuses.size} required rows at ${parsed.target.head}.`,
      'This command validates report structure and current-target fields; it does not execute or certify scenarios.',
      '',
    ].join('\n'));
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Homes evidence report is invalid: ${message}\n`);
  process.exitCode = 1;
});
