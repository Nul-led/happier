import {
  MAX_AUTOMATION_MATERIALIZED_INPUT_UTF8_BYTES,
  type AutomationRunCause,
  type WorkflowAuthoredProducerRef,
  type WorkflowCondition,
  type WorkflowDefinitionV1,
  type WorkflowStepComposerDocument,
  type WorkflowValueReference,
} from '@happier-dev/protocol';

export type WorkflowJsonValue = Extract<WorkflowValueReference, { kind: 'literal' }>['value'];

export type WorkflowInputResolutionErrorCode =
  | 'missing_reference'
  | 'invalid_reference_scope'
  | 'invalid_condition'
  | 'invalid_input'
  | 'missing_required_input'
  | 'workflow_input_too_large';

export class WorkflowInputResolutionError extends Error {
  readonly code: WorkflowInputResolutionErrorCode;

  constructor(code: WorkflowInputResolutionErrorCode) {
    super(code);
    this.name = 'WorkflowInputResolutionError';
    this.code = code;
  }
}

export function isWorkflowJsonObject(value: unknown): value is Readonly<Record<string, WorkflowJsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Projects one immutable Automation occurrence into the named-input seed.
 *
 * Schedule/session-lifecycle evidence already belongs to the bounded Run
 * cause. Plugin and Conversation payloads remain opaque to the server and are
 * opened only by the assigned daemon. This adapter deliberately does not
 * merge the two sources or infer fields from current trigger state.
 */
export function resolveAutomationWorkflowOccurrenceSeed(params: Readonly<{
  cause: AutomationRunCause;
  openedEvidence: unknown | null;
}>): Readonly<Record<string, WorkflowJsonValue>> {
  if (params.cause.kind === 'manual') {
    if (params.openedEvidence !== null) throw new WorkflowInputResolutionError('invalid_input');
    return {};
  }
  if (params.cause.kind === 'trigger' && params.cause.triggerKind === 'schedule') {
    if (params.openedEvidence !== null) throw new WorkflowInputResolutionError('invalid_input');
    return { scheduledFor: params.cause.evidence.scheduledFor };
  }
  if (params.cause.kind === 'trigger' && params.cause.triggerKind === 'sessionLifecycle') {
    if (params.openedEvidence !== null) throw new WorkflowInputResolutionError('invalid_input');
    return params.cause.evidence;
  }
  if (!isWorkflowJsonObject(params.openedEvidence)) {
    throw new WorkflowInputResolutionError('invalid_input');
  }
  return params.openedEvidence;
}

function matchesDeclaredInputType(value: WorkflowJsonValue, valueType: WorkflowDefinitionV1['inputs'][number]['valueType']): boolean {
  return valueType === 'json' || typeof value === valueType;
}

/**
 * Binds immutable Automation occurrence evidence to declared workflow inputs
 * by exact name. Undeclared evidence (for example schedule {scheduledFor}
 * for a zero-input workflow) is ignored: the immutable cause retains the full
 * evidence, but only declared exact-name inputs are selected and type-checked.
 * It never rewrites Composer text or guesses fields from an
 * event kind. The Automation adapter is responsible for supplying the
 * occurrence evidence object it admitted.
 */
export function bindAutomationWorkflowInputs(params: Readonly<{
  definition: Pick<WorkflowDefinitionV1, 'inputs'>;
  evidence: Readonly<Record<string, WorkflowJsonValue>>;
}>): Readonly<Record<string, WorkflowJsonValue>> {
  const bound: Record<string, WorkflowJsonValue> = {};
  for (const input of params.definition.inputs) {
    const hasSuppliedValue = Object.prototype.hasOwnProperty.call(params.evidence, input.name);
    const value = hasSuppliedValue ? params.evidence[input.name] : input.default;
    if (value === undefined) {
      if (input.required) throw new WorkflowInputResolutionError('missing_required_input');
      continue;
    }
    if (!matchesDeclaredInputType(value, input.valueType)) {
      throw new WorkflowInputResolutionError('invalid_input');
    }
    bound[input.name] = value;
  }
  return bound;
}

export type WorkflowValueResolutionRuntime = Readonly<{
  inputs: Readonly<Record<string, WorkflowJsonValue>>;
  item?: Readonly<{ value: WorkflowJsonValue; index: number; position: number; count: number }>;
  iteration?: Readonly<{
    index: number;
    position: number;
    count: number;
    stopReason: WorkflowJsonValue | null;
  }>;
  resolveResult: (
    producer: WorkflowAuthoredProducerRef,
  ) => Promise<WorkflowJsonValue>;
  resolveWorkspace: (
    producer: WorkflowAuthoredProducerRef,
  ) => Promise<Readonly<{ directory: string; checkoutRootPath: string }>>;
}>;

function selectWorkflowResultPath(
  value: WorkflowJsonValue,
  path: readonly (string | number)[],
): WorkflowJsonValue {
  let selected = value;
  for (const segment of path) {
    const next = Array.isArray(selected)
      ? (typeof segment === 'number' ? selected[segment] : undefined)
      : isWorkflowJsonObject(selected) && typeof segment === 'string'
        ? selected[segment]
        : undefined;
    if (next === undefined) throw new WorkflowInputResolutionError('invalid_reference_scope');
    selected = next;
  }
  return selected;
}

export async function resolveWorkflowValueReference(
  reference: WorkflowValueReference,
  runtime: WorkflowValueResolutionRuntime,
): Promise<WorkflowJsonValue> {
  switch (reference.kind) {
    case 'literal':
      return reference.value;
    case 'input': {
      if (!Object.prototype.hasOwnProperty.call(runtime.inputs, reference.name)) {
        throw new WorkflowInputResolutionError('missing_reference');
      }
      return runtime.inputs[reference.name]!;
    }
    case 'result': {
      const result = await runtime.resolveResult(reference.producer);
      return selectWorkflowResultPath(result, reference.path);
    }
    case 'workspace': {
      const workspace = await runtime.resolveWorkspace(reference.producer);
      return workspace[reference.field];
    }
    case 'item': {
      if (!runtime.item) throw new WorkflowInputResolutionError('invalid_reference_scope');
      return runtime.item[reference.field];
    }
    case 'iteration': {
      if (!runtime.iteration) throw new WorkflowInputResolutionError('invalid_reference_scope');
      return runtime.iteration[reference.field];
    }
  }
}

function sameJsonValue(left: WorkflowJsonValue, right: WorkflowJsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]!));
  }
  if (!isWorkflowJsonObject(left) || !isWorkflowJsonObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && sameJsonValue(left[key]!, right[key]!));
}

async function referenceExists(
  reference: WorkflowValueReference,
  runtime: WorkflowValueResolutionRuntime,
): Promise<boolean> {
  try {
    await resolveWorkflowValueReference(reference, runtime);
    return true;
  } catch (error) {
    if (error instanceof WorkflowInputResolutionError && error.code === 'missing_reference') return false;
    if (error instanceof WorkflowInputResolutionError) {
      throw new WorkflowInputResolutionError('invalid_condition');
    }
    throw error;
  }
}

async function resolveConditionValue(
  reference: WorkflowValueReference,
  runtime: WorkflowValueResolutionRuntime,
): Promise<WorkflowJsonValue> {
  try {
    return await resolveWorkflowValueReference(reference, runtime);
  } catch (error) {
    if (error instanceof WorkflowInputResolutionError) {
      throw new WorkflowInputResolutionError('invalid_condition');
    }
    throw error;
  }
}

export async function evaluateWorkflowCondition(
  condition: WorkflowCondition,
  runtime: WorkflowValueResolutionRuntime,
): Promise<boolean> {
  switch (condition.kind) {
    case 'exists':
      return await referenceExists(condition.value, runtime);
    case 'all':
      for (const child of condition.conditions) {
        if (!await evaluateWorkflowCondition(child, runtime)) return false;
      }
      return true;
    case 'any':
      for (const child of condition.conditions) {
        if (await evaluateWorkflowCondition(child, runtime)) return true;
      }
      return false;
    case 'not':
      return !await evaluateWorkflowCondition(condition.condition, runtime);
    case 'compare': {
      const left = await resolveConditionValue(condition.left, runtime);
      const right = await resolveConditionValue(condition.right, runtime);
      if (condition.operator === 'eq') return sameJsonValue(left, right);
      if (condition.operator === 'neq') return !sameJsonValue(left, right);
      // Ordering compares homogeneous operands only: two numbers numerically,
      // two strings by ordinary JavaScript lexical (UTF-16 code unit) order —
      // no locale transform, no coercion. This matches the Protocol
      // validator's admission contract for lt/lte/gt/gte.
      if ((typeof left === 'number' && typeof right === 'number')
        || (typeof left === 'string' && typeof right === 'string')) {
        switch (condition.operator) {
          case 'lt': return left < right;
          case 'lte': return left <= right;
          case 'gt': return left > right;
          case 'gte': return left >= right;
        }
      }
      throw new WorkflowInputResolutionError('invalid_condition');
    }
  }
}

export type MaterializedWorkflowStepInput = Readonly<{
  text: string;
  references: WorkflowStepComposerDocument['references'];
  attachments: WorkflowStepComposerDocument['attachments'];
  values: readonly WorkflowJsonValue[];
}>;

export async function materializeWorkflowStepInput(params: Readonly<{
  document: WorkflowStepComposerDocument;
  references: readonly WorkflowValueReference[];
  runtime: WorkflowValueResolutionRuntime;
}>): Promise<MaterializedWorkflowStepInput> {
  const values: WorkflowJsonValue[] = [];
  for (const reference of params.references) {
    values.push(await resolveWorkflowValueReference(reference, params.runtime));
  }
  const resolvedInputs = params.references.map((reference, index) => ({
    reference,
    value: values[index]!,
  }));
  const text = values.length === 0
    ? params.document.text
    : `${params.document.text}\n\n**Workflow inputs**\n\n${JSON.stringify(resolvedInputs)}`;
  if (Buffer.byteLength(text, 'utf8') > MAX_AUTOMATION_MATERIALIZED_INPUT_UTF8_BYTES) {
    throw new WorkflowInputResolutionError('workflow_input_too_large');
  }
  return {
    text,
    references: params.document.references,
    attachments: params.document.attachments,
    values,
  };
}
