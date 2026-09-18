import { type ActionInputHints, type JsonSchemaObject } from '@happier-dev/protocol';

import {
  compileActionCliFieldsFromJsonSchema,
  type ActionCliField,
} from '@/cli/actions/compiledCommands';
import {
  resolveActionCliInputCompletionCandidates,
  resolveActionCliInputCompletionCandidatesWithDynamicOptions,
  type ActionCliDynamicOptionsResolver,
} from '@/cli/actions/commandCompletion';
import {
  type ActionCliFlagCollision,
  validateActionCliFlagCollisions,
} from '@/cli/actions/parseCommandInput';
import type { ResolvedContributionRegistry } from '@/plugins/projection/registry/types';

import type { PluginCommandProjection } from './pluginCommandProjection';

/** `--input` remains an accepted spelling of whole-input JSON for installed callers. */
export const PLUGIN_COMMAND_INPUT_JSON_ALIASES: readonly string[] = Object.freeze(['--input', '--input-json']);

export type PluginCommandActionInputContract = Readonly<{
  fields: readonly ActionCliField[];
  inputSchema: JsonSchemaObject;
  flagCollision: ActionCliFlagCollision | null;
}>;

/** Translate only the plugin command's retained whole-input alias and host flag. */
export function normalizePluginCommandActionInputTokens(tokens: readonly string[]): readonly string[] {
  let positionalOnly = false;
  return Object.freeze(tokens.flatMap((token) => {
    if (positionalOnly) return [token];
    if (token === '--') {
      positionalOnly = true;
      return [token];
    }
    if (token === '--json') return [];
    if (token === '--input') return ['--input-json'];
    if (token.startsWith('--input=')) return [`--input-json=${token.slice('--input='.length)}`];
    return [token];
  }));
}

function readActionInputJsonSchema(definition: Readonly<Record<string, unknown>>): JsonSchemaObject | null {
  const schema = definition.inputSchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return null;
  return schema as JsonSchemaObject;
}

function readActionInputHints(definition: Readonly<Record<string, unknown>>): ActionInputHints | undefined {
  const hints = definition.inputHints;
  if (!hints || typeof hints !== 'object' || Array.isArray(hints)) return undefined;
  return hints as ActionInputHints;
}

/**
 * The complete canonical contributed-Action input contract used by command
 * parsing and final validation. `null` means the installed command references
 * a predecessor Action definition which is not present in this registry.
 */
export function resolvePluginCommandActionInputContract(params: Readonly<{
  registry: ResolvedContributionRegistry | undefined;
  qualifiedActionId: string;
}>): PluginCommandActionInputContract | null {
  // No registry snapshot means no discoverable canonical definition, which is
  // exactly the predecessor case: keep the JSON-only adapter.
  const contribution = (params.registry?.actions ?? []).find((candidate) => (
    candidate.pluginId
    && `${candidate.pluginId}/${candidate.definition.id}` === params.qualifiedActionId
  ));
  if (!contribution) return null;
  const definition = contribution.definition as unknown as Readonly<Record<string, unknown>>;
  const jsonSchema = readActionInputJsonSchema(definition);
  if (!jsonSchema) return null;
  const fields = compileActionCliFieldsFromJsonSchema({
    jsonSchema,
    hints: readActionInputHints(definition),
    reservedFlags: PLUGIN_COMMAND_INPUT_JSON_ALIASES,
  });
  const flagValidation = validateActionCliFlagCollisions(
    { fields, positionals: [] },
    { reservedFlags: PLUGIN_COMMAND_INPUT_JSON_ALIASES },
  );
  return Object.freeze({
    fields,
    inputSchema: jsonSchema,
    flagCollision: flagValidation.ok ? null : flagValidation,
  });
}

function resolvePluginCommandCompletionTarget(params: Readonly<{
  registry: ResolvedContributionRegistry;
  projection: PluginCommandProjection;
  committed: readonly string[];
}>): Readonly<{
  command: PluginCommandProjection['commands'][number];
  actionInput: PluginCommandActionInputContract | null;
}> | null {
  const command = params.projection.commands
    .filter((candidate) => (
      candidate.status === 'available'
      && candidate.path.length <= params.committed.length
      && candidate.path.every((segment, index) => params.committed[index] === segment)
    ))
    .sort((left, right) => right.path.length - left.path.length)[0];
  if (!command) return null;
  return Object.freeze({
    command,
    actionInput: resolvePluginCommandActionInputContract({
      registry: params.registry,
      qualifiedActionId: command.qualifiedActionId,
    }),
  });
}

/**
 * Completion for an exact available plugin command. The command contribution
 * owns its path while the contributed Action owns fields, aliases, and static
 * choices through the same helper used by first-party friendly commands.
 */
export function resolvePluginCommandCompletionCandidates(params: Readonly<{
  registry: ResolvedContributionRegistry;
  projection: PluginCommandProjection;
  committed: readonly string[];
  prefix: string;
  fallback: readonly string[];
}>): readonly string[] {
  const target = resolvePluginCommandCompletionTarget(params);
  if (!target) return Object.freeze([]);
  const { command, actionInput } = target;
  if (!actionInput) {
    return command.path.length === params.committed.length
      ? Object.freeze(params.fallback.filter((candidate) => candidate.startsWith(params.prefix)))
      : Object.freeze([]);
  }
  if (actionInput.flagCollision) return Object.freeze([]);

  const actionCommitted = params.committed.slice(command.path.length);
  const candidates = new Set(resolveActionCliInputCompletionCandidates({
    target: { fields: actionInput.fields, positionals: [] },
    committed: actionCommitted,
    prefix: params.prefix,
  }));
  // `--input` is the installed plugin-command compatibility spelling for the
  // canonical parser's `--input-json`. It remains an adapter, not Action input.
  const usedWholeInput = actionCommitted.some((token) => (
    token === '--input'
    || token.startsWith('--input=')
    || token === '--input-json'
    || token.startsWith('--input-json=')
  ));
  if (
    !actionCommitted.includes('--')
    && !usedWholeInput
    && '--input'.startsWith(params.prefix)
    && (params.prefix === '' || params.prefix.startsWith('-'))
  ) {
    candidates.add('--input');
  }
  return Object.freeze([...candidates].sort());
}

/** Dynamic contributed-command completion through the same options Action as built-ins. */
export async function resolvePluginCommandCompletionCandidatesWithDynamicOptions(params: Readonly<{
  registry: ResolvedContributionRegistry;
  projection: PluginCommandProjection;
  committed: readonly string[];
  prefix: string;
  fallback: readonly string[];
  resolveDynamicOptions: ActionCliDynamicOptionsResolver;
}>): Promise<readonly string[]> {
  const candidates = new Set(resolvePluginCommandCompletionCandidates(params));
  const target = resolvePluginCommandCompletionTarget(params);
  if (!target) return Object.freeze([...candidates].sort());
  const { command, actionInput } = target;
  if (!actionInput || actionInput.flagCollision) return Object.freeze([...candidates].sort());
  const actionCommitted = normalizePluginCommandActionInputTokens(
    params.committed.slice(command.path.length),
  );
  for (const candidate of await resolveActionCliInputCompletionCandidatesWithDynamicOptions({
    target: { fields: actionInput.fields, positionals: [] },
    actionId: command.qualifiedActionId,
    committed: actionCommitted,
    prefix: params.prefix,
    resolveDynamicOptions: params.resolveDynamicOptions,
  })) {
    candidates.add(candidate);
  }
  return Object.freeze([...candidates].sort());
}
