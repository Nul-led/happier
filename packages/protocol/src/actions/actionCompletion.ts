import { z } from 'zod';

import { sameStrictJsonValue, StrictJsonValueSchema, type JsonValue } from '../json/strictJsonValue.js';
import { validateExecutionRunProfileResult } from '../execution/runs/resultContract.js';
import { normalizePluginJsonSchema } from '../plugins/actions/protocolComposableSchema.js';
import { PluginJsonSchemaV2Schema } from '../plugins/contributions/jsonSchema.js';
import { zodSchemaToJsonSchemaObject } from './actionInputJsonSchema.js';
import type { ActionExecuteResult } from './actionExecutionResult.js';
import type { ExecutionRunGetResponse } from '../execution/runs/responseSchemas.js';

export type ActionCompletionRun = Readonly<{ key: string; runId: string }>;
export type ActionCompletionLaunchFailure = Readonly<{ key: string; errorCode: string }>;
export type ReviewRunMaterialization =
  | Readonly<{ kind: 'complete' }>
  | Readonly<{ kind: 'partial' | 'failed'; errorCode: string }>;

/** Terminal evidence supplied by the execution-run observation owner, never an Action poll. */
export type ExecutionRunTerminalObservation =
  | Readonly<{
    kind: 'completed'; result: JsonValue;
    reviewedFingerprint?: string | null;
    commentIds?: readonly string[];
    materialization?: ReviewRunMaterialization;
  }>
  | Readonly<{ kind: 'failed'; code: string }>
  | Readonly<{ kind: 'cancelled'; code?: string }>
  | Readonly<{ kind: 'outcome_uncertain'; code: string }>;

const TerminalMaterializationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('complete') }).strict(),
  z.object({ kind: z.literal('partial'), errorCode: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('failed'), errorCode: z.string().min(1) }).strict(),
]);
const TerminalReviewEvidenceSchema = z.object({
  reviewedFingerprint: z.string().nullable().optional(),
  commentIds: z.array(z.string().min(1)).optional(),
  materialization: TerminalMaterializationSchema.optional(),
}).strip();

/** Adapts a validated native terminal snapshot, not a polling Action or raw findings. */
export function readActionCompletionRunObservationV1(native: Readonly<{
  run: Pick<ExecutionRunGetResponse['run'], 'status' | 'error'>;
  latestToolResult?: unknown;
}>): ExecutionRunTerminalObservation {
  if (native.run.status === 'failed' || native.run.status === 'timeout') {
    return { kind: 'failed', code: native.run.error?.code ?? 'execution_run_failed' };
  }
  if (native.run.status === 'cancelled') return { kind: 'cancelled' };
  if (native.run.status !== 'succeeded') return { kind: 'outcome_uncertain', code: 'execution_run_not_terminal' };
  const tool = native.latestToolResult;
  const output = tool !== null && typeof tool === 'object' && !Array.isArray(tool) && 'output' in tool ? tool.output : undefined;
  const value = StrictJsonValueSchema.safeParse(output);
  if (!value.success) return { kind: 'outcome_uncertain', code: 'execution_run_result_unavailable' };
  const evidence = TerminalReviewEvidenceSchema.safeParse(value.data);
  return { kind: 'completed', result: value.data, ...(evidence.success ? evidence.data : {}) };
}

export type ActionCompletionDeclaration = Readonly<{
  awaits: 'execution_runs';
  launched: (output: unknown) => Readonly<{
    runs: readonly ActionCompletionRun[];
    failed: readonly ActionCompletionLaunchFailure[];
  }>;
  terminalOutputSchema: z.ZodType;
  terminal: (output: unknown, runs: readonly Readonly<
    ActionCompletionRun & { outcome: ExecutionRunTerminalObservation }
  >[]) => unknown;
}>;

export const ActionCompletionContractV1Schema = z.object({
  awaits: z.literal('execution_runs'),
  terminalOutputSchema: PluginJsonSchemaV2Schema,
}).strict();
export type ActionCompletionContractV1 = z.infer<typeof ActionCompletionContractV1Schema>;

const ActionCompletionRunSchema = z.object({ key: z.string().min(1), runId: z.string().min(1) }).strict();
const ActionCompletionLaunchesSchema = z.object({
  runs: z.array(ActionCompletionRunSchema),
  failed: z.array(z.object({ key: z.string().min(1), errorCode: z.string().min(1) }).strict()),
}).strict();
export const ActionCompletionStateV1Schema = z.object({
  output: StrictJsonValueSchema,
  awaitedRuns: z.array(ActionCompletionRunSchema).min(1),
}).strict();
export type ActionCompletionStateV1 = z.infer<typeof ActionCompletionStateV1Schema>;

export type ActionCompletionResult =
  | Readonly<{ kind: 'completed'; value: JsonValue }>
  | Readonly<{ kind: 'failed'; errorCode: string }>
  | Readonly<{ kind: 'outcome_uncertain'; errorCode: 'outcome_uncertain' }>;

export function freezeActionCompletionContractV1(declaration: ActionCompletionDeclaration): ActionCompletionContractV1 {
  return {
    awaits: declaration.awaits,
    terminalOutputSchema: normalizePluginJsonSchema(zodSchemaToJsonSchemaObject(
      declaration.terminalOutputSchema, { target: 'draft-7' },
    )),
  };
}

export function prepareActionCompletionV1(
  declaration: ActionCompletionDeclaration | undefined,
  executed: ActionExecuteResult,
): ActionCompletionResult | Readonly<{ kind: 'awaiting'; state: ActionCompletionStateV1 }> {
  if (!executed.ok) return { kind: 'failed', errorCode: executed.errorCode };
  const output = StrictJsonValueSchema.safeParse(executed.result);
  if (!output.success) return { kind: 'failed', errorCode: 'invalid_action_output' };
  if (!declaration) return { kind: 'completed', value: output.data };
  try {
    const launched = ActionCompletionLaunchesSchema.parse(declaration.launched(output.data));
    if (launched.runs.length === 0) {
      return { kind: 'failed', errorCode: launched.failed[0]?.errorCode ?? 'action_failed' };
    }
    // This fact must be persisted by the caller before invoking the observation phase.
    return { kind: 'awaiting', state: { output: output.data, awaitedRuns: launched.runs } };
  } catch {
    // The invoke has already happened: invalid launch correspondence cannot safely be retried.
    return { kind: 'outcome_uncertain', errorCode: 'outcome_uncertain' };
  }
}

export async function resumeActionCompletionV1(params: Readonly<{
  actionId: string;
  completion: unknown;
  state: unknown;
  resolveDeclaration: (actionId: string) => ActionCompletionDeclaration | undefined;
  observeRun: (run: ActionCompletionRun) => Promise<ExecutionRunTerminalObservation>;
}>): Promise<ActionCompletionResult> {
  const uncertain = { kind: 'outcome_uncertain', errorCode: 'outcome_uncertain' } as const;
  const contract = ActionCompletionContractV1Schema.safeParse(params.completion);
  const state = ActionCompletionStateV1Schema.safeParse(params.state);
  if (!contract.success || !state.success) return uncertain;
  let declaration: ActionCompletionDeclaration | undefined;
  try {
    declaration = params.resolveDeclaration(params.actionId);
    if (!declaration || declaration.awaits !== contract.data.awaits) return uncertain;
    const launches = ActionCompletionLaunchesSchema.parse(declaration.launched(state.data.output));
    if (!sameStrictJsonValue(launches.runs, state.data.awaitedRuns)) return uncertain;
  } catch {
    return uncertain;
  }
  // Await every launched run. A transport failure is unknown, not a failed/cancelled run fact.
  const observed = await Promise.allSettled(state.data.awaitedRuns.map(async (run) => ({
    ...run, outcome: await params.observeRun(run),
  })));
  const runs: Array<ActionCompletionRun & { outcome: ExecutionRunTerminalObservation }> = [];
  for (const result of observed) {
    if (result.status === 'rejected' || result.value.outcome.kind === 'outcome_uncertain') return uncertain;
    runs.push(result.value);
  }
  let terminal: unknown;
  try {
    terminal = declaration.terminal(state.data.output, runs);
  } catch {
    // The current retained-state parser no longer understands this persisted invocation.
    return uncertain;
  }
  const value = StrictJsonValueSchema.safeParse(terminal);
  if (!value.success) return { kind: 'failed', errorCode: 'invalid_action_output' };
  // Typed producer output is already decoded: do not JSON.parse strings a second time.
  const validated = validateExecutionRunProfileResult(value.data, {
    kind: 'json', schema: contract.data.terminalOutputSchema,
  });
  return validated.ok
    ? { kind: 'completed', value: validated.value }
    : { kind: 'failed', errorCode: 'invalid_action_output' };
}
