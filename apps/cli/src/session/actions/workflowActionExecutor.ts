import {
  WorkflowActionInputSchemasV1,
  WorkflowActionOutputSchemasV1,
  validateWorkflowDefinition,
  type WorkflowActionExecute,
  type WorkflowActionExecuteArgs,
  type WorkflowActionIdV1,
  type WorkflowIngressContextV1,
} from '@happier-dev/protocol';

type DefinitionActions = Readonly<{
  list: (input: ReturnType<typeof WorkflowActionInputSchemasV1['workflow.definition.list']['parse']>) => Promise<WorkflowActionResult>;
  get: (input: ReturnType<typeof WorkflowActionInputSchemasV1['workflow.definition.get']['parse']>) => Promise<WorkflowActionResult>;
  create: (input: ReturnType<typeof WorkflowActionInputSchemasV1['workflow.definition.create']['parse']>, context?: WorkflowIngressContextV1) => Promise<WorkflowActionResult>;
  update: (input: ReturnType<typeof WorkflowActionInputSchemasV1['workflow.definition.update']['parse']>, context?: WorkflowIngressContextV1) => Promise<WorkflowActionResult>;
  delete: (input: ReturnType<typeof WorkflowActionInputSchemasV1['workflow.definition.delete']['parse']>) => Promise<WorkflowActionResult>;
}>;

type RunActionId = Extract<WorkflowActionIdV1, `workflow.run.${string}`>;
type RunActionArgs = { [TActionId in RunActionId]: WorkflowActionExecuteArgs<TActionId> }[RunActionId];
type WorkflowActionResult = Awaited<ReturnType<WorkflowActionExecute>>;

function isWorkflowRunActionArgs(args: WorkflowActionExecuteArgs): args is RunActionArgs {
  return args.actionId.startsWith('workflow.run.');
}

export type WorkflowRunActionOwner = Readonly<{
  execute: (args: RunActionArgs, context?: WorkflowIngressContextV1) => Promise<WorkflowActionResult>;
}>;

type WorkflowTargetValidation = Readonly<{
  targetValidation: 'checked' | 'unavailable';
  targetIssues?: ReadonlyArray<Readonly<{
    code: 'target_unavailable'; path: string; message: string; severity: 'error' | 'warning';
  }>>;
}>;

/**
 * The CLI host's single workflow-family adapter for the canonical Action
 * executor. Run semantics remain in the injected origin-neutral Run owner;
 * definition persistence remains in the Account Artifact owner.
 */
export function createWorkflowActionExecutor(deps: Readonly<{
  isWorkflowFeatureEnabled: () => Promise<boolean> | boolean;
  definitions: DefinitionActions;
  runs: WorkflowRunActionOwner;
  resolveIngressContext?: (args: WorkflowActionExecuteArgs) => Promise<WorkflowIngressContextV1 | undefined>;
  resolveTargetValidation?: (args: WorkflowActionExecuteArgs<'workflow.validate'>) => Promise<WorkflowTargetValidation>;
}>): WorkflowActionExecute {
  return async (rawArgs) => {
    let featureEnabled = false;
    try {
      featureEnabled = await deps.isWorkflowFeatureEnabled();
    } catch {
      featureEnabled = false;
    }
    if (!featureEnabled) {
      return { ok: false, errorCode: 'content_unavailable', error: 'content_unavailable' };
    }

    const actionId = rawArgs.actionId;
    if (actionId === 'workflow.run.wait'
      && (rawArgs.context.surface === 'agent' || rawArgs.context.surface === 'mcp')
      && rawArgs.context.defaultSessionId
      && rawArgs.input.timeoutSeconds === undefined) {
      return { ok: false, errorCode: 'invalid_input', error: 'invalid_input' };
    }
    const resolvesIngress = actionId === 'workflow.validate'
      || actionId === 'workflow.run.start'
      || actionId === 'workflow.run.resume'
      || actionId === 'workflow.run.invocations.retry'
      || actionId === 'workflow.definition.create'
      || actionId === 'workflow.definition.update';
    const context = resolvesIngress
      ? await deps.resolveIngressContext?.(rawArgs)
      : undefined;
    if (actionId === 'workflow.validate') {
      const input = WorkflowActionInputSchemasV1[actionId].parse(rawArgs.input);
      const target = input.target
        ? await deps.resolveTargetValidation?.({ ...rawArgs, actionId, input })
          ?? { targetValidation: 'unavailable' as const }
        : { targetValidation: 'not_requested' as const };
      return WorkflowActionOutputSchemasV1[actionId].parse(validateWorkflowDefinition(input.definition, {
        ...(context ? { context } : {}),
        ...target,
      }));
    }
    if (actionId === 'workflow.definition.list') {
      return await deps.definitions.list(WorkflowActionInputSchemasV1[actionId].parse(rawArgs.input));
    }
    if (actionId === 'workflow.definition.get') {
      return await deps.definitions.get(WorkflowActionInputSchemasV1[actionId].parse(rawArgs.input));
    }
    if (actionId === 'workflow.definition.create') {
      return await deps.definitions.create(WorkflowActionInputSchemasV1[actionId].parse(rawArgs.input), context);
    }
    if (actionId === 'workflow.definition.update') {
      return await deps.definitions.update(WorkflowActionInputSchemasV1[actionId].parse(rawArgs.input), context);
    }
    if (actionId === 'workflow.definition.delete') {
      return await deps.definitions.delete(WorkflowActionInputSchemasV1[actionId].parse(rawArgs.input));
    }
    if (!isWorkflowRunActionArgs(rawArgs)) {
      return { ok: false, errorCode: 'content_unavailable', error: 'content_unavailable' };
    }
    switch (rawArgs.actionId) {
      case 'workflow.run.start':
      case 'workflow.run.list':
      case 'workflow.run.get':
      case 'workflow.run.wait':
      case 'workflow.run.pause':
      case 'workflow.run.resume':
      case 'workflow.run.cancel':
      case 'workflow.run.invocations.list':
      case 'workflow.run.invocations.get':
      case 'workflow.run.invocations.retry':
      case 'workflow.run.delete':
        WorkflowActionInputSchemasV1[rawArgs.actionId].parse(rawArgs.input);
        return await deps.runs.execute(rawArgs, context);
    }
  };
}
