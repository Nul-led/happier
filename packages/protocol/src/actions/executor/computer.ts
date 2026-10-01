import { ACTION_ID_FAMILIES_V1, type RuntimeActionIdV1 } from '../actionIds.js';
import type { RuntimeActionDispatchArgs } from './types.js';

export const COMPUTER_RUNTIME_ACTION_IDS = ACTION_ID_FAMILIES_V1.computer;
export type ComputerRuntimeActionId = (typeof COMPUTER_RUNTIME_ACTION_IDS)[number];
const COMPUTER_RUNTIME_ACTION_ID_SET: ReadonlySet<RuntimeActionIdV1> = new Set(COMPUTER_RUNTIME_ACTION_IDS);

export function isComputerRuntimeActionId(actionId: RuntimeActionIdV1): actionId is ComputerRuntimeActionId {
  return COMPUTER_RUNTIME_ACTION_ID_SET.has(actionId);
}

export async function executeComputerRuntimeAction(args: RuntimeActionDispatchArgs<ComputerRuntimeActionId>): Promise<unknown> {
  return args.runtimeActionExecute({ actionId: args.actionId, input: args.input, context: args.context });
}
