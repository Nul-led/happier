import { listBuiltInHappierTools } from '@/agent/tools/happierTools/listBuiltInHappierTools';
import { z } from 'zod';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ProgressNotification, RequestMeta } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '@/ui/logger';

type BridgeRequestExtra = Readonly<{
  signal?: AbortSignal;
  _meta?: RequestMeta;
  sendNotification?: (notification: ProgressNotification) => Promise<void>;
}>;

export type HappierBridgeCallOptions = Readonly<{
  signal?: AbortSignal;
  requestMetadata?: RequestMeta;
  onprogress?: RequestOptions['onprogress'];
}>;

// Tool registration for the host-owned Happier MCP bridge.
type ToolRegistrar = Readonly<{
  registerTool: (
    name: string,
    definition: any,
    handler: (args: any, extra?: BridgeRequestExtra) => Promise<any>,
  ) => void;
}>;

function toBridgeSchema(schema: unknown): z.ZodType {
  if (schema instanceof z.ZodType) {
    return schema;
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return z.object({}).passthrough();
  }

  // MCP discovery returns JSON Schema while the high-level MCP server accepts
  // Zod registrations. This proxy deliberately validates permissively and
  // preserves the discovered schema for presentation; the remote server is
  // the authoritative validation and execution owner.
  const adapter = z.object({}).passthrough();
  adapter._zod.processJSONSchema = (_ctx, json) => {
    Object.assign(json, schema);
  };
  return adapter;
}

export function registerHappierBridgeTools(
  server: ToolRegistrar,
  deps: Readonly<{
    callHttpTool: (
      name: string,
      args: unknown,
      options?: HappierBridgeCallOptions,
    ) => Promise<any>;
    tools?: readonly Readonly<{
      name: string;
      title?: string;
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
      annotations?: unknown;
      _meta?: Record<string, unknown>;
    }>[];
  }>,
): void {
  const forward = (name: string) => async (
    args: any,
    extra?: BridgeRequestExtra,
  ) => {
    const progressToken = extra?._meta?.progressToken;
    const pendingProgressNotifications: Promise<void>[] = [];
    const onprogress = (
      (typeof progressToken === 'string' || typeof progressToken === 'number')
      && typeof extra?.sendNotification === 'function'
    )
      ? (progress: Readonly<{ progress: number; total?: number; message?: string }>) => {
        const notification = extra.sendNotification?.({
          method: 'notifications/progress',
          params: { ...progress, progressToken },
        }).catch((error) => {
          logger.debug('[happierMCP] Failed to forward tool progress', error);
        });
        if (notification) pendingProgressNotifications.push(notification);
      }
      : undefined;
    try {
      const options = {
        ...(extra?.signal === undefined ? {} : { signal: extra.signal }),
        ...(extra?._meta === undefined ? {} : { requestMetadata: extra._meta }),
        ...(onprogress === undefined ? {} : { onprogress }),
      };
      const result = Object.keys(options).length === 0
        ? await deps.callHttpTool(name, args)
        : await deps.callHttpTool(name, args, options);
      await Promise.all(pendingProgressNotifications);
      return result;
    } catch (error) {
      if (extra?.signal?.aborted === true) {
        throw error;
      }
      return {
        content: [
          { type: 'text', text: `Failed to call tool ${name}: ${error instanceof Error ? error.message : String(error)}` },
        ],
        isError: true,
      };
    }
  };

  // Production bridges forward the upstream exact-runtime catalog. The local
  // fallback has no exact Home feature fact, so server-backed tools fail closed.
  const tools = deps.tools ?? listBuiltInHappierTools({
    surface: 'agent',
    isServerFeatureEnabled: () => false,
  });
  for (const tool of tools) {
    const meta = {
      description: tool.description ?? tool.title ?? tool.name,
      title: tool.title ?? tool.name,
      inputSchema: toBridgeSchema(tool.inputSchema),
      ...(tool.outputSchema === undefined ? {} : { outputSchema: toBridgeSchema(tool.outputSchema) }),
      ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
      ...(tool._meta === undefined ? {} : { _meta: tool._meta }),
    };

    server.registerTool(tool.name, meta, forward(tool.name));
  }
}
