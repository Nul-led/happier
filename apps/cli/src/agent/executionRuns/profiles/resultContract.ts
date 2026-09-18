import {
  compilePluginJsonSchema,
  isValidPluginJsonSchemaValue,
  normalizePluginJsonSchema,
  StrictJsonValueSchema,
  type ExecutionRunResultContractV1,
  type PluginJsonSchemaV2,
  type JsonValue,
} from '@happier-dev/protocol';

export type ExecutionRunProfileResultContract =
  | ExecutionRunResultContractV1
  | Readonly<{ kind: 'json'; schema: PluginJsonSchemaV2 }>;

export function normalizeExecutionRunProfileResultContract(
  contract: ExecutionRunProfileResultContract | undefined,
): ExecutionRunProfileResultContract | undefined {
  if (!contract) return undefined;
  if (contract.kind !== 'json') return contract;
  return { kind: 'json', schema: normalizePluginJsonSchema(contract.schema) };
}

export function buildExecutionRunResultContractPrompt(
  contract: ExecutionRunProfileResultContract | undefined,
): string | null {
  if (!contract || contract.kind === 'text') return null;
  if (contract.kind === 'decision') {
    return [
      'Return only one strict JSON string containing one of these required decision values:',
      JSON.stringify(contract.decisions),
    ].join('\n');
  }
  return [
    'Return only one strict JSON value that satisfies this required result schema:',
    JSON.stringify(contract.schema),
  ].join('\n');
}

export type ExecutionRunResultDecodeResult =
  | Readonly<{ ok: true; value: JsonValue | string }>
  | Readonly<{ ok: false }>;

/** Validates a result that the canonical Execution Run owner already decoded. */
export function validateExecutionRunProfileResult(
  value: JsonValue | string,
  contract: ExecutionRunProfileResultContract | undefined,
): ExecutionRunResultDecodeResult {
  if (!contract || contract.kind === 'text') {
    return typeof value === 'string' ? { ok: true, value } : { ok: false };
  }
  const strictJson = StrictJsonValueSchema.safeParse(value);
  if (!strictJson.success) return { ok: false };
  if (contract.kind === 'decision') {
    return typeof strictJson.data === 'string' && contract.decisions.includes(strictJson.data)
      ? { ok: true, value: strictJson.data }
      : { ok: false };
  }
  try {
    const validates = compilePluginJsonSchema(contract.schema);
    return isValidPluginJsonSchemaValue(validates, strictJson.data)
      ? { ok: true, value: strictJson.data }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

export function decodeExecutionRunProfileResult(
  rawText: string,
  contract: ExecutionRunProfileResultContract | undefined,
): ExecutionRunResultDecodeResult {
  if (!contract || contract.kind === 'text') return { ok: true, value: rawText };
  const exactText = rawText.trim();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(exactText);
  } catch {
    return { ok: false };
  }
  const strictJson = StrictJsonValueSchema.safeParse(parsedJson);
  if (!strictJson.success) return { ok: false };
  return validateExecutionRunProfileResult(strictJson.data, contract);
}
