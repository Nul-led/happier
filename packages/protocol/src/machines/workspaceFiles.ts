import { z } from 'zod';
import { DEFAULT_MACHINE_TUNNEL_SERVER_ROUTED_MAX_RAW_PAYLOAD_BYTES } from '../features/payload/capabilities/machineTunnelCapabilities.js';

/** Matches the existing workspace corpus ceiling used by repository-tree/file-search consumers. */
export const WORKSPACE_FILE_LIST_MAX_RESULTS = 5_000;
/** Keeps one typed response inside the canonical server-routed Machine RPC raw-payload ceiling. */
export const WORKSPACE_FILE_LIST_MAX_RESPONSE_UTF8_BYTES = DEFAULT_MACHINE_TUNNEL_SERVER_ROUTED_MAX_RAW_PAYLOAD_BYTES;
export const WORKSPACE_FILE_LIST_MAX_QUERY_CODE_UNITS = 1_024;

export const DaemonWorkspaceFileListRequestSchema = z.object({
  rootPath: z.string().trim().min(1).max(10_000),
  query: z.string().max(WORKSPACE_FILE_LIST_MAX_QUERY_CODE_UNITS).optional(),
  includeHidden: z.boolean().optional(),
  limit: z.number().int().positive().max(WORKSPACE_FILE_LIST_MAX_RESULTS).optional(),
}).strict();
export type DaemonWorkspaceFileListRequest = z.infer<typeof DaemonWorkspaceFileListRequestSchema>;

export const DaemonWorkspaceFileListErrorCodeSchema = z.enum([
  'invalid_request',
  'path_not_allowed',
  'method_unavailable',
  'ripgrep_unavailable',
  'ripgrep_failed',
]);
export type DaemonWorkspaceFileListErrorCode = z.infer<typeof DaemonWorkspaceFileListErrorCodeSchema>;

const DaemonWorkspaceFileListSuccessSchema = z.object({
  ok: z.literal(true),
  paths: z.array(z.string().min(1))
    .max(WORKSPACE_FILE_LIST_MAX_RESULTS),
  truncated: z.boolean(),
}).strict().superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > WORKSPACE_FILE_LIST_MAX_RESPONSE_UTF8_BYTES) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Workspace file-list response exceeds ${WORKSPACE_FILE_LIST_MAX_RESPONSE_UTF8_BYTES} UTF-8 bytes`,
    });
  }
});

const DaemonWorkspaceFileListFailureSchema = z.object({
  ok: z.literal(false),
  errorCode: DaemonWorkspaceFileListErrorCodeSchema,
  exitCode: z.number().int().optional(),
}).strict();

export const DaemonWorkspaceFileListResponseSchema = z.discriminatedUnion('ok', [
  DaemonWorkspaceFileListSuccessSchema,
  DaemonWorkspaceFileListFailureSchema,
]);
export type DaemonWorkspaceFileListResponse = z.infer<typeof DaemonWorkspaceFileListResponseSchema>;
