import { ACTION_IDS } from './actionIds.js';
import { ActionIdSchema, type ActionId } from './actionIds.js';
import type { ActionExecutorContext } from './actionExecutor.js';
import type {
  ActionSettingsActionId,
  ActionsSettingsV1,
  ActionSettingsOverride,
} from './actionSettings.js';
import { resolveActionApprovalFlow, type ActionApprovalFlow, type ActionApprovalResult } from './actionApprovalMetadata.js';
import { getActionSpec, type ActionSpec, type ActionSurfaces } from './actionSpecs.js';

export type ActionApprovalRoutingDecision = Readonly<{
  required: boolean;
  flow: ActionApprovalFlow;
  result: ActionApprovalResult;
}>;

export type ResolveActionApprovalRoutingArgs = Readonly<{
  actionId: ActionId;
  spec: ActionSpec;
  settings?: ActionsSettingsV1 | null;
  context?: Pick<ActionExecutorContext, 'surface' | 'authority' | 'presentUserConfirmation'> | null;
  requiredByPolicy?: boolean;
}>;

function isApprovalAction(actionId: ActionId): boolean {
  return actionId === 'approval.request.list'
    || actionId === 'approval.request.get'
    || actionId === 'approval.request.create'
    || actionId === 'approval.request.decide';
}

/**
 * Non-danger egress-sensitive leaves that must reach human consent on `agent` even though
 * their `safety` is `'safe'`. These capture page/region/element pixels or summaries that egress to
 * the composer/agent turn (or expose/copy public URLs), so the agent-initiated forms are
 * approval-floored.
 *
 * RESERVED for non-danger egress leaves ONLY. Mutating/navigating/danger actions must NOT be added
 * here — they are classified `safety: 'danger'` in the actionSpecs danger SSOT and are picked up
 * automatically by the danger-floor derivation below. Keeping that split preserves the single
 * source of truth (CON-2: do not hand-add browser verbs to this const).
 *
 * Annotation `start`/`cancel` + `attachComment`/`attachStroke`/`attachStyleIntent` are local
 * UI-state edits with no page egress and stay unprompted.
 */
export const EGRESS_SENSITIVE_AGENT_FLOOR = [
  'browser.context.capturePage',
  'browser.context.captureScreenshot',
  'browser.context.captureSelectedElement',
  'browser.context.captureNetworkSummary',
  'browser.context.captureConsoleSummary',
  'browser.context.annotation.captureRegion',
  'browser.context.annotation.captureElement',
  'browser.context.attachToComposer',
  'browser.context.attachToAgentTurn',
  'browser.recording.attachToComposer',
  'localServices.publicPreview.status',
  'localServices.publicPreview.copyUrl',
] as const satisfies readonly ActionId[];

/**
 * The danger floor, DERIVED from the actionSpecs danger SSOT: every action that is both
 * `safety: 'danger'` and surfaced on `agent` requires human consent by default when
 * initiated through the agent surface. This is the single source of truth — marking an
 * `agent` action as `safety: 'danger'` floors it automatically (CON-1/CON-2/CON-3).
 *
 * This intentionally uses the full action catalog, not only `RUNTIME_ACTION_IDS_V1`: LIVE-1 caught
 * `prompt_doc.update`, a dangerous Session agent prompt-library action that still needs the same
 * consent floor even though it is not part of the runtime-action family.
 */
const DERIVED_DANGER_AGENT_FLOOR_IDS: readonly ActionId[] = ACTION_IDS.filter(
  (id) => {
    const spec = getActionSpec(id);
    return spec.safety === 'danger' && spec.surfaces.agent === true;
  },
);

/**
 * The effective agent-initiated approval floor: the derived danger floor UNIONED with the
 * non-danger egress floor. The floor legitimately ⊋ {danger ∩ agent}; the closure
 * invariant is a SUBSET test ({danger ∩ agent} ⊆ floor), NEVER equality.
 *
 * Per FINALIZATION-PLAN §4.2 / §12.8 / §15-Δ1 / §16-Δ1 this is a SURFACE-KEYED default — NOT a
 * global `RESULT_REQUIRED_APPROVAL_ACTION_IDS` addition (that set is a blocking-result contract,
 * not a human-approval gate). Human approval is decided here, via the persisted
 * surface-keyed ActionsSettings policy: dangerous exposed Actions prompt by default on every
 * user-configurable surface, while non-danger egress forms remain agent-gated.
 *
 * Persisted overrides may require or explicitly waive confirmation on a known surface.
 * Missing or malformed policy retains this default. Egress redaction is independent.
 *
 * Note: `network.intercept` (named in §4.2) is a plugin GRANT capability, not an ActionSpec id,
 * so it is gated by the durable plugin-grants store (§12.2), not by this approval policy.
 */
export const AGENT_INITIATED_APPROVAL_REQUIRED_ACTION_IDS: readonly ActionId[] = [
  ...DERIVED_DANGER_AGENT_FLOOR_IDS,
  ...EGRESS_SENSITIVE_AGENT_FLOOR,
];

/**
 * Dangerous Actions are confirmation-floored on every user-configurable surface
 * where the Action is actually exposed. This is separate from the agent egress
 * floor above: safe capture/egress Actions remain agent-only, while destructive
 * Actions keep the same default-on, user-overridable confirmation contract for
 * UI, CLI, MCP, API, plugin, voice, and Agent callers.
 */
const DANGEROUS_ACTION_APPROVAL_REQUIRED_ACTION_ID_SET: ReadonlySet<ActionId> = new Set(
  ACTION_IDS.filter((id) => getActionSpec(id).safety === 'danger'),
);

const AGENT_INITIATED_APPROVAL_REQUIRED_ACTION_ID_SET: ReadonlySet<ActionId> = new Set(
  AGENT_INITIATED_APPROVAL_REQUIRED_ACTION_IDS,
);
type ActionSurfaceKey = keyof ActionSurfaces;
type NonAgentActionSurfaceKey = Exclude<ActionSurfaceKey, 'agent'>;

const NON_AGENT_ACTION_SURFACE_KEY_RECORD = {
  ui: true,
  voice: true,
  mcp: true,
  cli: true,
  rpc: true,
  api: true,
  plugin: true,
} satisfies Record<NonAgentActionSurfaceKey, true>;

const NON_AGENT_ACTION_SURFACE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(NON_AGENT_ACTION_SURFACE_KEY_RECORD),
);

type ApprovalSurfaceResolution =
  | Readonly<{ kind: 'agent'; surface: 'agent' }>
  | Readonly<{ kind: 'non_agent'; surface: NonAgentActionSurfaceKey }>
  | Readonly<{ kind: 'ambiguous' }>;

function resolveApprovalSurface(
  ctx?: Pick<ActionExecutorContext, 'surface'> | null,
): ApprovalSurfaceResolution {
  const surface: unknown = ctx?.surface ?? null;
  if (surface === 'agent') return { kind: 'agent', surface };
  if (typeof surface === 'string' && NON_AGENT_ACTION_SURFACE_KEYS.has(surface)) {
    return { kind: 'non_agent', surface: surface as NonAgentActionSurfaceKey };
  }
  return { kind: 'ambiguous' };
}

/**
 * The single fail-closed surface test shared by every agent trust-boundary decision: the caller
 * is the agent, or the surface could not be resolved and is therefore treated as the agent.
 * Only an explicitly recognised non-agent surface (`ui`/`voice`/`mcp`/`cli`/`rpc`/`api`/`plugin`)
 * escapes it.
 */
function isAgentOrUnresolvedSurface(
  ctx?: Pick<ActionExecutorContext, 'surface'> | null,
): boolean {
  const surface = resolveApprovalSurface(ctx);
  return surface.kind === 'agent' || surface.kind === 'ambiguous';
}

/**
 * True when an Action result leaving the host on this surface must be redacted before it can
 * egress to an agent turn — the canonical owner of the egress-surface question (INV-1 / DEC-2).
 *
 * This is deliberately the SAME resolution as the agent approval floor above: consent and egress
 * are two halves of one agent trust boundary and must not disagree. It replaced two hand-rolled
 * `context.surface === 'agent'` allowlists (the local-services runtime-action executors in the
 * daemon and in the UI sync domain) which failed OPEN — every surface value other than the exact
 * string `'agent'`, including `undefined`, received the unredacted payload.
 *
 * This predicate answers *whether* to redact. *What* to redact stays with the payload owner (for
 * public-preview URLs: `local/services/public/v1.ts`); do not add redaction rules here.
 */
export function requiresAgentEgressRedaction(
  ctx?: Pick<ActionExecutorContext, 'surface'> | null,
): boolean {
  return isAgentOrUnresolvedSurface(ctx);
}

/**
 * True when `actionId` is in the dangerous agent-initiated subset that requires human approval
 * by default. Exported so the action-settings UI (Phase 3.3) can surface the default and let a
 * user require, waive, or restore the default confirmation policy.
 */
export function isAgentInitiatedApprovalRequiredByDefault(actionId: ActionId): boolean {
  return AGENT_INITIATED_APPROVAL_REQUIRED_ACTION_ID_SET.has(actionId);
}

function requiresDefaultApprovalFloor(
  actionId: ActionId,
  ctx?: Pick<ActionExecutorContext, 'surface' | 'authority' | 'presentUserConfirmation'> | null,
): boolean {
  const surface = resolveApprovalSurface(ctx);
  // UI already owns its direct present-user confirmation host. CLI suppresses
  // the duplicate default only when its host records a completed confirmation
  // for this exact Action. Explicit settings are evaluated first and still win.
  if (
    surface.kind === 'non_agent'
    && (
      surface.surface === 'ui'
      || (surface.surface === 'cli' && ctx?.presentUserConfirmation?.actionId === actionId)
    )
    && ctx?.authority === 'present_user'
  ) {
    return false;
  }
  if (DANGEROUS_ACTION_APPROVAL_REQUIRED_ACTION_ID_SET.has(actionId)) {
    if (surface.kind === 'ambiguous') return true;
    // RPC is an internal transport surface; it has no human confirmation host.
    if (surface.surface !== 'rpc') {
      return getActionSpec(actionId).surfaces[surface.surface] === true;
    }
  }
  return isAgentOrUnresolvedSurface(ctx) && isAgentInitiatedApprovalRequiredByDefault(actionId);
}

/**
 * Generic approvals policy resolution rooted in persisted ActionsSettings.
 *
 * Notes:
 * - This answers “should this action be routed through approvals on this surface?”
 * - It does not decide enablement (use `isActionEnabledByActionsSettings` separately).
 * - Missing/unknown surfaces fail closed by applying the danger/egress floor. Known exposed
 *   surfaces use the dangerous default unless a persisted waiver explicitly opts out.
 */
export function isApprovalRequiredByActionsSettings(
  actionId: ActionSettingsActionId,
  settings: ActionsSettingsV1,
  ctx?: Pick<ActionExecutorContext, 'surface' | 'authority' | 'presentUserConfirmation'> | null,
): boolean {
  const surface = resolveApprovalSurface(ctx);
  const rawSurface = ctx?.surface;
  const override: ActionSettingsOverride | undefined = settings.actions?.[actionId];
  const required = Array.isArray(override?.approvalRequiredSurfaces) ? override.approvalRequiredSurfaces : [];
  if (typeof rawSurface === 'string' && required.some((requiredSurface) => requiredSurface === rawSurface)) return true;
  const waived = Array.isArray(settings.approvalWaivedSurfaces?.[actionId])
    ? settings.approvalWaivedSurfaces[actionId]
    : [];
  if (surface.kind !== 'ambiguous' && waived.includes(surface.surface)) return false;

  const builtInActionId = ActionIdSchema.safeParse(actionId);
  return builtInActionId.success && requiresDefaultApprovalFloor(builtInActionId.data, ctx);
}

/**
 * Fail-safe default when no approval-requirement signal is supplied (neither an explicit
 * `requiredByPolicy` boolean nor persisted `settings`). A host that never wired the approval
 * policy must NOT silently fall open for dangerous Actions: the surface-keyed danger floor
 * still applies on every recognized exposed surface. Unknown surfaces retain the fail-closed
 * result, while internal RPC has no human confirmation host.
 *
 * Centralized here (rather than coerced at the executor call site with `=== true`) so the safe
 * default is applied in exactly one place. F7 (Runtime Unification v2 finalization).
 */
function resolveUnwiredApprovalDefault(
  actionId: ActionId,
  context: Pick<ActionExecutorContext, 'surface' | 'authority' | 'presentUserConfirmation'> | null | undefined,
): boolean {
  return requiresDefaultApprovalFloor(actionId, context);
}

export function resolveActionApprovalRouting(args: ResolveActionApprovalRoutingArgs): ActionApprovalRoutingDecision {
  const requiredByPolicy = typeof args.requiredByPolicy === 'boolean'
    ? args.requiredByPolicy
    : args.settings
      ? isApprovalRequiredByActionsSettings(args.actionId, args.settings, args.context)
      : resolveUnwiredApprovalDefault(args.actionId, args.context);
  const required = !isApprovalAction(args.actionId) && requiredByPolicy;

  // The public Action API reports a created approval artifact to its caller;
  // it cannot retain an HTTP or server-relay request as the blocking waiter.
  // The present-user UI ordinarily has the same lifecycle shape: its mounted
  // continuation follows the Artifact and consumes the replayed typed result,
  // while the original invocation returns immediately. A live-only result is
  // the deliberate exception: the exact invocation stays as the blocking
  // waiter because its raw result must never become durable Artifact custody.
  // Keep required-result metadata for replay/settlement, and leave Agent/CLI/
  // MCP blocking callers unchanged.
  const mustReturnApprovalCustody = args.spec.approvalResultCustody !== 'live_only'
    && (
      args.context?.surface === 'api'
      || (
        args.context?.surface === 'ui'
        && args.context?.authority === 'present_user'
      )
    );
  const flow = required && mustReturnApprovalCustody
    ? 'deferred'
    : resolveActionApprovalFlow(args.spec.approval);

  return {
    required,
    flow,
    result: args.spec.approval.result,
  };
}
