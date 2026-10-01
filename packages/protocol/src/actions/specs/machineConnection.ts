import { z } from 'zod';
import { DaemonTerminalEnsureRequestSchema, DaemonTerminalEnsureResponseSchema, DaemonTerminalListRequestV1Schema, DaemonTerminalListResponseV1Schema } from '../../daemon/terminal.js';
import type { PreNormalizedActionSpec } from '../actionSpecs.js';

const id = z.string().trim().min(1);
export const HomeConnectInputSchema = z.object({
  address: id,
  displayName: id.optional(),
  acceptInsecureHttp: z.boolean().default(false),
  acceptCanonicalUrl: z.boolean().default(false),
}).strict();
export const HomeConnectOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('connected'), serverId: id, serverUrl: id, name: z.string() }).strict(),
  z.object({ kind: z.literal('invalid_address') }).strict(),
  z.object({ kind: z.literal('declined') }).strict(),
  z.object({ kind: z.literal('mixed_content') }).strict(),
  z.object({ kind: z.literal('unreachable') }).strict(),
]);
export const MachineAddCommandInputSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('another_computer'), serverId: id, os: z.enum(['macos', 'linux', 'windows']) }).strict(),
  z.object({ method: z.literal('ssh'), serverId: id, os: z.enum(['macos', 'linux', 'windows']),
    host: id, username: z.string().optional(), port: z.number().int().min(1).max(65535).optional(),
    authMode: z.enum(['agent', 'keyfile', 'password']).default('agent'), identityFilePath: z.string().optional(),
  }).strict(),
]);
export const MachineAddCommandOutputSchema = z.object({ command: id, descriptorFileRequired: z.boolean() }).strict();
export const MachinePairingCreateInputSchema = z.object({ serverId: id }).strict();
export const MachinePairingCreateOutputSchema = z.object({ pairId: id, link: id, expiresAtMs: z.number().int().nonnegative() }).strict();
export const MACHINE_ADD_SSH_ACTION_IDS = ['machines.add.ssh.start', 'machines.add.ssh.status', 'machines.add.ssh.respond', 'machines.add.ssh.cancel'] as const;
export type MachineAddSshActionId = typeof MACHINE_ADD_SSH_ACTION_IDS[number];
export const MachineAddSshStartInputSchema = z.object({ serverId: id, host: id, username: z.string().default(''),
  port: z.number().int().min(1).max(65535).optional(), authMode: z.enum(['agent', 'keyfile', 'password']).default('agent'),
  identityFilePath: z.string().optional(),
}).strict();
export const MachineAddSshTaskInputSchema = z.object({ taskId: id }).strict();
export const MachineAddSshAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ssh.trustHost'), trusted: z.boolean() }).strict(),
  z.object({ kind: z.literal('ssh.replaceHostKey'), trusted: z.boolean() }).strict(),
  z.object({ kind: z.literal('auth.approveRemoteProvisioning'), approved: z.boolean() }).strict(),
  z.object({ kind: z.literal('daemon.replaceRemoteBackgroundServices'), replaceExistingServices: z.boolean() }).strict(),
  z.object({ kind: z.literal('releaseChannel.switchDefaultForSetup'), switchDefaultReleaseChannel: z.boolean() }).strict(),
]);
export const MachineAddSshRespondInputSchema = MachineAddSshTaskInputSchema.extend({ answer: MachineAddSshAnswerSchema }).strict();
export const MachineAddSshTaskOutputSchema = z.object({ taskId: id }).strict();
export const MachineAddSshStatusOutputSchema = z.object({ taskId: id, status: z.enum(['running', 'canceling', 'succeeded', 'failed', 'canceled']),
  currentStepId: z.string().nullable(), awaitingInput: z.boolean(),
  prompt: z.object({ kind: id, message: z.string(), fingerprint: z.string().optional(), existingFingerprint: z.string().nullable().optional(),
    target: z.string().optional(), publicKey: z.string().nullable().optional(), requiresPresentUser: z.boolean() }).strict().nullable(),
  machineId: z.string().nullable(), errorCode: z.string().nullable(),
}).strict();
export const MACHINE_ADD_SSH_INPUT_SCHEMAS = {
  'machines.add.ssh.start': MachineAddSshStartInputSchema, 'machines.add.ssh.status': MachineAddSshTaskInputSchema,
  'machines.add.ssh.respond': MachineAddSshRespondInputSchema, 'machines.add.ssh.cancel': MachineAddSshTaskInputSchema,
} as const;

// Reuse the daemon's request fields and validation; only the Action's routing
// envelope is new. Unknown author fields cannot gain meaning at this seam.
export const MachineTerminalOpenInputSchema = DaemonTerminalEnsureRequestSchema
  .safeExtend({ machineId: id, serverId: id.optional() }).strict();
export const MachineTerminalListInputSchema = DaemonTerminalListRequestV1Schema
  .extend({ machineId: id, serverId: id.optional() }).strict();

const clientSurfaces = { ui: true, voice: false, agent: true, mcp: true, cli: false, rpc: false } as const;
export const MACHINE_CONNECTION_ACTION_SPECS = [
  {
    id: 'machines.terminal.list', title: 'List machine terminals',
    description: 'Read existing machine terminals and their Session attribution without opening or changing a process. Null means this daemon does not support listing.',
    safety: 'safe', sideEffectClass: 'read', executionPlacement: 'machine', placements: [],
    surfaces: { ui: true, voice: false, agent: true, mcp: true, cli: true, rpc: false },
    bindings: { mcpToolName: 'machines_terminal_list' }, inputSchema: MachineTerminalListInputSchema, outputSchema: DaemonTerminalListResponseV1Schema.nullable(),
    inputHints: { fields: [{ path: 'machineId', title: 'Machine ID', widget: 'text', required: true }, { path: 'serverId', title: 'Home ID', widget: 'text' }] },
  },
  {
    id: 'machines.add.ssh.start', title: 'Add machine over SSH',
    description: 'Start the existing client SSH setup task on the focused signed-in Home. Read status and answer non-secret prompts. Password and private-key entry stays with the present-user UI.',
    safety: 'danger', sideEffectClass: 'danger', executionPlacement: 'client', placements: [], surfaces: clientSurfaces,
    bindings: { mcpToolName: 'machines_add_ssh_start' }, inputSchema: MachineAddSshStartInputSchema, outputSchema: MachineAddSshTaskOutputSchema,
    inputHints: { fields: [{ path: 'serverId', title: 'Home ID', widget: 'text', required: true }, { path: 'host', title: 'SSH host', widget: 'text', required: true },
      { path: 'username', title: 'SSH user', widget: 'text' }, { path: 'port', title: 'SSH port', widget: 'text' }, { path: 'authMode', title: 'Authentication', widget: 'text' },
      { path: 'identityFilePath', title: 'Identity file', widget: 'text' }] },
  },
  {
    id: 'machines.add.ssh.status', title: 'Read SSH machine setup', description: 'Read the retained SSH setup task and its current prompt. Task success is not proof of Home feed arrival.',
    safety: 'safe', sideEffectClass: 'read', executionPlacement: 'client', placements: [], surfaces: clientSurfaces,
    bindings: { mcpToolName: 'machines_add_ssh_status' }, inputSchema: MachineAddSshTaskInputSchema, outputSchema: MachineAddSshStatusOutputSchema,
    inputHints: { fields: [{ path: 'taskId', title: 'Task ID', widget: 'text', required: true }] },
  },
  {
    id: 'machines.add.ssh.respond', title: 'Answer SSH setup prompt', description: 'Answer the exact current SSH setup prompt; trust and service changes are never accepted implicitly.',
    safety: 'danger', sideEffectClass: 'danger', executionPlacement: 'client', placements: [], surfaces: clientSurfaces,
    bindings: { mcpToolName: 'machines_add_ssh_respond' }, inputSchema: MachineAddSshRespondInputSchema, outputSchema: MachineAddSshTaskOutputSchema,
    inputHints: { fields: [{ path: 'taskId', title: 'Task ID', widget: 'text', required: true }, { path: 'answer', title: 'Prompt answer', widget: 'json', required: true }] },
  },
  {
    id: 'machines.add.ssh.cancel', title: 'Cancel SSH machine setup', description: 'Cancel the retained SSH task through its existing system-task owner.',
    safety: 'safe', sideEffectClass: 'write', executionPlacement: 'client', placements: [], surfaces: clientSurfaces,
    bindings: { mcpToolName: 'machines_add_ssh_cancel' }, inputSchema: MachineAddSshTaskInputSchema, outputSchema: MachineAddSshTaskOutputSchema,
    inputHints: { fields: [{ path: 'taskId', title: 'Task ID', widget: 'text', required: true }] },
  },
  {
    id: 'homes.connect', title: 'Connect a Home by address',
    description: 'Check and save a Home address, returning the canonical connection outcome. Device focus stays with the current Home.',
    safety: 'safe', sideEffectClass: 'write', executionPlacement: 'client', placements: [], surfaces: clientSurfaces,
    bindings: { mcpToolName: 'homes_connect' }, inputSchema: HomeConnectInputSchema, outputSchema: HomeConnectOutputSchema,
    inputHints: { fields: [{ path: 'address', title: 'Home address', widget: 'text', required: true },
      { path: 'displayName', title: 'Home name', widget: 'text' },
      { path: 'acceptInsecureHttp', title: 'Accept insecure HTTP', widget: 'boolean' },
      { path: 'acceptCanonicalUrl', title: 'Use the advertised canonical address', widget: 'boolean' }] },
  },
  {
    id: 'machines.add.command', title: 'Prepare machine setup command',
    description: 'Get the existing SSH or another-computer setup command for a saved Home. This does not install or connect the machine.',
    safety: 'safe', sideEffectClass: 'read', executionPlacement: 'client', placements: [], surfaces: clientSurfaces,
    bindings: { mcpToolName: 'machines_add_command' }, inputSchema: MachineAddCommandInputSchema, outputSchema: MachineAddCommandOutputSchema,
    inputHints: { fields: [{ path: 'serverId', title: 'Home ID', widget: 'text', required: true },
      { path: 'method', title: 'Setup method', widget: 'select', required: true, options: [{ value: 'another_computer', label: 'Another computer' }, { value: 'ssh', label: 'SSH' }] },
      { path: 'os', title: 'Operating system', widget: 'select', required: true, options: [{ value: 'macos', label: 'macOS' }, { value: 'linux', label: 'Linux' }, { value: 'windows', label: 'Windows' }] },
      { path: 'host', title: 'SSH host', widget: 'text' }, { path: 'username', title: 'SSH user', widget: 'text' },
      { path: 'port', title: 'SSH port', widget: 'text' }, { path: 'authMode', title: 'SSH authentication', widget: 'text' }, { path: 'identityFilePath', title: 'Identity file', widget: 'text' }] },
  },
  {
    id: 'machines.pairing.create', title: 'Create another-computer pairing link',
    description: 'Issue a short-lived Home pairing link through the trusted device enrollment lifecycle. Keep this client running until the computer joins.',
    safety: 'danger', sideEffectClass: 'danger', executionPlacement: 'client', placements: [], surfaces: clientSurfaces,
    bindings: { mcpToolName: 'machines_pairing_create' }, inputSchema: MachinePairingCreateInputSchema, outputSchema: MachinePairingCreateOutputSchema,
    projectObservationOutput: () => ({ redacted: true }),
    approvalResultCustody: 'live_only',
    inputHints: { fields: [{ path: 'serverId', title: 'Home ID', widget: 'text', required: true }] },
  },
  {
    id: 'machines.terminal.open', title: 'Open machine terminal',
    description: 'Create or reuse a machine PTY shell through the daemon terminal owner.',
    safety: 'danger', sideEffectClass: 'danger', executionPlacement: 'machine', placements: [],
    surfaces: { ui: true, voice: false, agent: true, mcp: true, cli: true, rpc: false },
    bindings: { mcpToolName: 'machines_terminal_open' }, inputSchema: MachineTerminalOpenInputSchema, outputSchema: DaemonTerminalEnsureResponseSchema,
    inputHints: { fields: [{ path: 'machineId', title: 'Machine ID', widget: 'text', required: true },
      { path: 'serverId', title: 'Home ID', widget: 'text' }, { path: 'terminalKey', title: 'Terminal key', widget: 'text', required: true },
      { path: 'cwd', title: 'Working directory', widget: 'text' }, { path: 'cols', title: 'Columns', widget: 'text' }, { path: 'rows', title: 'Rows', widget: 'text' },
      { path: 'initialCommand', title: 'Initial command', widget: 'text' }, { path: 'launch', title: 'Launch intent', widget: 'json' }, { path: 'sessionId', title: 'Owning Session ID', widget: 'text' }] },
  },
] as const satisfies readonly PreNormalizedActionSpec[];
