import {
  UiBrowserAutomationDispatchRequestV1Schema,
  UiBrowserAutomationDispatchResultV1Schema,
  uiBrowserAutomationDispatchMethod,
  type RuntimeActionExecute,
} from '@happier-dev/protocol';

import type { ReverseCaptureMachineRpcClient } from '../recording/reverseChannel/desktopReverseCaptureUiCall';

type MachineClient = ReverseCaptureMachineRpcClient & Readonly<{
  hasConnectedClientRpcHandler: (method: string) => boolean;
}>;

const unavailable = { ok: false, errorCode: 'runtime_action_disabled', error: 'runtime_action_disabled:browser:browser_ui_automation_unavailable' } as const;

export function createBrowserAutomationReverseDispatcher(input: Readonly<{
  getMachineClient: () => MachineClient | null | undefined;
}>): RuntimeActionExecute {
  return async (args) => {
    const record = args.input && typeof args.input === 'object' ? args.input as Record<string, unknown> : {};
    if (typeof record.browserSessionId !== 'string' || typeof record.viewId !== 'string') return unavailable;
    const method = uiBrowserAutomationDispatchMethod({ browserSessionId: record.browserSessionId, viewId: record.viewId });
    const client = input.getMachineClient();
    if (!client?.hasConnectedClientRpcHandler(method)) return unavailable;
    const request = UiBrowserAutomationDispatchRequestV1Schema.safeParse({
      v: 1, actionId: args.actionId, input: args.input,
      ...(args.context.authority ? { authority: args.context.authority } : {}),
    });
    if (!request.success) return unavailable;
    args.context.signal?.throwIfAborted();
    try {
      // Automation owns its execution budget; do not let the generic RPC default cut
      // a valid long-running page action off first.
      const response = await client.callConnectedClientRpc(method, request.data,
        typeof record.timeoutMs === 'number' ? { timeoutMs: record.timeoutMs } : undefined);
      args.context.signal?.throwIfAborted();
      if (!response.ok) return unavailable;
      const parsed = UiBrowserAutomationDispatchResultV1Schema.safeParse(response.result);
      return parsed.success ? parsed.data : unavailable;
    } catch {
      args.context.signal?.throwIfAborted();
      return unavailable;
    }
  };
}
