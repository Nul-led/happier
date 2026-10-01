import { z } from 'zod';

import type { ActionCompletionDeclaration, ActionCompletionRun, ExecutionRunTerminalObservation } from '../actionCompletion.js';

// Retained immediate output is a compatibility seam: additional owner fields survive,
// but the launched run identity and the Action's intent must remain explicit.
const FanoutOutputSchema = z.object({
  intent: z.enum(['review', 'plan']),
  sessionId: z.string().nullable(),
  reviewedFingerprint: z.string().nullable().optional(),
  results: z.array(z.discriminatedUnion('ok', [
    z.object({ key: z.string().min(1), ok: z.literal(true), result: z.object({ runId: z.string().min(1) }).passthrough() }).passthrough(),
    z.object({ key: z.string().min(1), ok: z.literal(false), errorCode: z.string().min(1).optional(), error: z.string().min(1).optional() }).passthrough(),
  ])),
}).passthrough();

const MaterializationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('complete') }).strict(),
  z.object({ kind: z.literal('partial'), errorCode: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('failed'), errorCode: z.string().min(1) }).strict(),
]);
const PerEngineOutcomeSchema = z.object({
  key: z.string().min(1), runId: z.string().min(1).optional(),
  outcome: z.enum(['completed', 'failed', 'cancelled', 'launch_failed']),
  errorCode: z.string().min(1).optional(), materialization: MaterializationSchema.optional(),
}).strict();

function readFanoutOutput(output: unknown, intent: 'review' | 'plan') {
  const parsed = FanoutOutputSchema.parse(output);
  if (parsed.intent !== intent) throw new Error('Retained Action intent changed');
  return parsed;
}

function readLaunches(output: unknown, intent: 'review' | 'plan') {
  const parsed = readFanoutOutput(output, intent);
  return {
    runs: parsed.results.flatMap((item) => item.ok ? [{ key: item.key, runId: item.result.runId }] : []),
    failed: parsed.results.flatMap((item) => item.ok ? [] : [{
      key: item.key, errorCode: item.errorCode ?? item.error ?? 'execution_run_failed',
    }]),
  };
}

type ObservedRun = Readonly<ActionCompletionRun & { outcome: ExecutionRunTerminalObservation }>;
function perRunOutcome({ key, runId, outcome }: ObservedRun) {
  return {
    key, runId, outcome: outcome.kind,
    ...(outcome.kind !== 'completed' && outcome.code ? { errorCode: outcome.code } : {}),
  };
}

function launchFailureOutcomes(output: unknown, intent: 'review' | 'plan') {
  return readLaunches(output, intent).failed.map((failure) => ({ ...failure, outcome: 'launch_failed' as const }));
}

export const ReviewStartTerminalValueV1Schema = z.object({
  reviewedFingerprint: z.string().nullable(),
  commentIds: z.array(z.string().min(1)),
  perEngineOutcome: z.array(PerEngineOutcomeSchema),
}).strict();

export const reviewStartCompletion: ActionCompletionDeclaration = {
  awaits: 'execution_runs',
  terminalOutputSchema: ReviewStartTerminalValueV1Schema,
  launched: (output) => readLaunches(output, 'review'),
  terminal: (output, runs) => {
    const retained = readFanoutOutput(output, 'review');
    const completed = runs.flatMap(({ outcome }) => outcome.kind === 'completed' ? [outcome] : []);
    const fingerprints = completed.map((outcome) => outcome.reviewedFingerprint === undefined
      ? retained.reviewedFingerprint : outcome.reviewedFingerprint);
    const agreed = fingerprints[0];
    const reviewedFingerprint = retained.reviewedFingerprint !== null && typeof agreed === 'string' && agreed.length > 0
      && completed.length === runs.length && launchFailureOutcomes(output, 'review').length === 0
      && fingerprints.every((fingerprint) => fingerprint === agreed)
      && (retained.reviewedFingerprint === undefined || retained.reviewedFingerprint === agreed)
      ? agreed : null;
    return {
      reviewedFingerprint,
      // Only the host bridge's materialized ids count; raw findings are not proof of writes.
      commentIds: [...new Set(completed.flatMap((outcome) => outcome.commentIds ?? []))],
      perEngineOutcome: [
        ...runs.map((run) => ({
          ...perRunOutcome(run),
          ...(run.outcome.kind === 'completed' ? {
            materialization: run.outcome.materialization && run.outcome.commentIds
              ? run.outcome.materialization
              : { kind: 'failed', errorCode: 'review_materialization_unavailable' },
          } : {}),
        })),
        ...launchFailureOutcomes(output, 'review'),
      ],
    };
  },
};

export const planStartCompletion: ActionCompletionDeclaration = {
  awaits: 'execution_runs',
  terminalOutputSchema: z.object({
    plans: z.array(z.object({ key: z.string().min(1), runId: z.string().min(1), value: z.unknown() }).strict()),
    perEngineOutcome: z.array(PerEngineOutcomeSchema),
  }).strict(),
  launched: (output) => readLaunches(output, 'plan'),
  terminal: (output, runs) => ({
    plans: runs.flatMap(({ key, runId, outcome }) => outcome.kind === 'completed'
      ? [{ key, runId, value: outcome.result }] : []),
    perEngineOutcome: [...runs.map(perRunOutcome), ...launchFailureOutcomes(output, 'plan')],
  }),
};
