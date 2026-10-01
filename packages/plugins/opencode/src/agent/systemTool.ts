export const OPEN_CODE_SYSTEM_TOOL_ID = 'opencode-cli';
export const OPEN_CODE_STABLE_SYSTEM_TOOL_ID = 'opencode-cli-stable';
export const OPEN_CODE_V2_SYSTEM_TOOL_ID = 'opencode-cli-v2';

export type OpenCodeSystemToolId =
  | typeof OPEN_CODE_SYSTEM_TOOL_ID
  | typeof OPEN_CODE_STABLE_SYSTEM_TOOL_ID
  | typeof OPEN_CODE_V2_SYSTEM_TOOL_ID;

export function resolveOpenCodeSystemToolId(rawGeneration: unknown): OpenCodeSystemToolId {
  const generation = typeof rawGeneration === 'string'
    ? rawGeneration.trim().toLowerCase()
    : '';
  if (generation === 'stable') return OPEN_CODE_STABLE_SYSTEM_TOOL_ID;
  if (generation === 'v2') return OPEN_CODE_V2_SYSTEM_TOOL_ID;
  return OPEN_CODE_SYSTEM_TOOL_ID;
}
