import { z } from 'zod';
import type { PreNormalizedActionSpec } from './actionSpecs.js';

export const WORKSPACE_ACTION_IDS = [
  'workspace.tabs.list', 'workspace.tabs.open', 'workspace.tabs.activate', 'workspace.tabs.close',
  'workspace.tabs.pin', 'workspace.tabs.move', 'workspace.tabs.reorder', 'workspace.groups.focus', 'workspace.groups.maximize',
  'workspace.groups.restore', 'workspace.split', 'workspace.resize',
] as const;
export type WorkspaceActionId = typeof WORKSPACE_ACTION_IDS[number];

const id = z.string().trim().min(1);
export const WORKSPACE_ACTION_INPUT_SCHEMAS = {
  'workspace.tabs.list': z.object({}).strict(),
  'workspace.tabs.open': z.object({ href: id.optional(), tabId: id.optional(), groupId: id.optional(), mode: z.enum(['preview', 'newTab']).optional() }).strict(),
  'workspace.tabs.activate': z.object({ tabId: id }).strict(),
  'workspace.tabs.close': z.object({ tabId: id }).strict(),
  'workspace.tabs.pin': z.object({ tabId: id, pinned: z.boolean() }).strict(),
  'workspace.tabs.move': z.object({ tabId: id, targetGroupId: id }).strict(),
  'workspace.tabs.reorder': z.object({ tabId: id, index: z.number().int().nonnegative() }).strict(),
  'workspace.groups.focus': z.object({ groupId: id }).strict(),
  'workspace.groups.maximize': z.object({ groupId: id }).strict(),
  'workspace.groups.restore': z.object({}).strict(),
  'workspace.split': z.object({ tabId: id.optional(), groupId: id.optional(), direction: z.enum(['left', 'right', 'up', 'down']) }).strict(),
  'workspace.resize': z.object({ splitId: id, ratio: z.number().finite().min(0).max(1) }).strict(),
} as const;

export const WorkspaceTabsListOutputSchema = z.object({
  ok: z.literal(true),
  tabs: z.array(z.object({
    id, groupId: id, target: z.object({ kind: id, params: z.record(z.string(), z.string()) }).strict(),
    pinned: z.boolean(), preview: z.boolean(),
  }).strict()),
  groups: z.array(z.object({ id, tabIds: z.array(id), activeTabId: id }).strict()),
  splits: z.array(z.object({ id, axis: z.enum(['row', 'column']), ratio: z.number().finite().min(0).max(1), firstNodeId: id, secondNodeId: id }).strict()),
  rootNodeId: id,
  focusedGroupId: id, maximizedGroupId: id.nullable(),
}).strict();
const MutationOutputSchema = z.object({ ok: z.literal(true) }).strict();
export const WORKSPACE_ACTION_OUTPUT_SCHEMAS = {
  'workspace.tabs.list': WorkspaceTabsListOutputSchema,
  'workspace.tabs.open': MutationOutputSchema,
  'workspace.tabs.activate': MutationOutputSchema,
  'workspace.tabs.close': MutationOutputSchema,
  'workspace.tabs.pin': MutationOutputSchema,
  'workspace.tabs.move': MutationOutputSchema,
  'workspace.tabs.reorder': MutationOutputSchema,
  'workspace.groups.focus': MutationOutputSchema,
  'workspace.groups.maximize': MutationOutputSchema,
  'workspace.groups.restore': MutationOutputSchema,
  'workspace.split': MutationOutputSchema,
  'workspace.resize': MutationOutputSchema,
} as const;
export type WorkspaceTabsListOutput = z.infer<typeof WorkspaceTabsListOutputSchema>;

function row<const TId extends WorkspaceActionId>(actionId: TId, title: string) {
  return {
    id: actionId, title,
    description: 'Operate on the mounted client workspace in its current Home, Account and window. A headless host without that workspace returns unsupported_action.',
    safety: 'safe', sideEffectClass: actionId === 'workspace.tabs.list' ? 'read' : 'external',
    executionPlacement: 'client', placements: [],
    surfaces: { ui: true, voice: true, agent: true, mcp: true, cli: true, rpc: false },
    bindings: { mcpToolName: actionId.replaceAll('.', '_'), voiceClientToolName: actionId.replaceAll('.', '_') },
    cli: { commands: [{ path: actionId.split('.'), visibility: 'canonical' }] },
    inputSchema: WORKSPACE_ACTION_INPUT_SCHEMAS[actionId], outputSchema: WORKSPACE_ACTION_OUTPUT_SCHEMAS[actionId],
  } satisfies PreNormalizedActionSpec;
}

export const WORKSPACE_ACTION_SPECS = [
  row('workspace.tabs.list', 'List workspace tabs'), row('workspace.tabs.open', 'Open workspace tab'),
  row('workspace.tabs.activate', 'Activate workspace tab'), row('workspace.tabs.close', 'Close workspace tab'),
  row('workspace.tabs.pin', 'Pin or unpin workspace tab'), row('workspace.tabs.move', 'Move workspace tab'),
  row('workspace.tabs.reorder', 'Reorder workspace tab'),
  row('workspace.groups.focus', 'Focus workspace group'), row('workspace.groups.maximize', 'Maximize workspace group'),
  row('workspace.groups.restore', 'Restore workspace groups'), row('workspace.split', 'Split workspace'),
  row('workspace.resize', 'Resize workspace split'),
] as const;

export function isWorkspaceActionId(value: string): value is WorkspaceActionId {
  return (WORKSPACE_ACTION_IDS as readonly string[]).includes(value);
}
