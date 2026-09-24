# The Actions platform

An **Action** is one named, schema-typed user intent — `session.list`, `teams.policy.set`,
`session.board.get` — declared once and projected to every surface it opts into: UI, Voice, Agent
tools, MCP, CLI, Machine RPC, the public HTTP API, and plugins. The point of the platform is that
a new capability is added by declaring a row, not by writing a command, a tool, a route, a
permission check and a confirmation dialog five times.

This page describes the platform's owners and its admission vocabulary. The public HTTP wire
contract lives in [api.md](api.md#external-action-api-developer-preview-source-contract); the CLI
host is in [cli-architecture.md](cli-architecture.md#action-derived-command-arguments).

## Canonical owners

| Decision or fact | Owner |
|---|---|
| The Action registry: every row, its schemas, surfaces, safety and approval | `packages/protocol/src/actions/actionSpecs.ts` |
| Surface-independent metadata vocabulary (surfaces, authority, placement, tool exposure) | `packages/protocol/src/actions/metadata.ts` |
| Discovery projection and serialization for external consumers | `packages/protocol/src/actions/actionCatalog.ts`, `.../actionDefinitionV1.ts` |
| Execution: input parse, authority admission, approval routing, output settlement | `packages/protocol/src/actions/actionExecutor.ts` |
| Whether an invocation needs approval, and which approval flow | `packages/protocol/src/actions/actionApprovalPolicy.ts` |
| Friendly CLI command projection | `packages/protocol/src/actions/actionCliProjection.ts` |
| CLI presentation, including demoting an ineffective success | `apps/cli/src/cli/actions/commandPresentation.ts`, `.../executeCommand.ts` |
| Machine-RPC route class for an Action-bearing method | `packages/protocol/src/machines/peer/mediation/rpc/routePolicyV1.ts` |

There is no server-side Action executor. Three hosts execute: the UI executor
(`apps/ui/sources/sync/ops/actions/defaultActionExecutor.ts`), the daemon executor
(`apps/cli/src/session/actions/createCliActionDeps.ts`, which also serves the CLI, Agents and
MCP), and the public API's relay to a daemon. A server-owned Action declares its Home path on
its spec row and the family clients build their requests from that declaration — see
`serverTransport` below.

## The three host-stamped facts

Three fields on a spec row are stamped by the host and never accepted from Action input. Together
they decide who may invoke an Action, where it runs, and how it reaches the Home.

**`requiredAuthority`** — `account_automation` or `present_user`. It is deliberately independent
of transport: a Personal Access Token and a trusted plugin both carry automation authority, while
an interactive host path can carry a present user. A row may declare it — the Team identity,
directory, and external-group-binding row builders declare present-user for anything whose
`sideEffectClass` is not `read` — and otherwise `resolveActionRequiredAuthority` resolves it
from one explicit id set (`PRESENT_USER_REQUIRED_ACTION_ID_VALUES`), defaulting to
`account_automation`. Either way the answer is computed once. This is also what
derives the public API surface: `surfaces.api` is computed, and
`requiredAuthority === 'account_automation'` is one of its preconditions, so a present-user Action
cannot be exposed to the API by editing a surface flag.

**`executionPlacement`** — `account`, `machine`, `session`, or `client`. External ingress resolves
an Action's execution target from this registry fact rather than from the id's prefix, so a new
Action cannot silently inherit a Machine route by being added next to one. `client` deliberately
reports placement unavailable to remote APIs.

**`serverTransport`** — an optional `{ method, path }` pair naming the Home route that carries a
server-owned Action. It is a local declaration only: the domain route still owns wire validation
and authorization, and the field is intentionally excluded from serialization
(`serializeActionSpec` builds its output field by field and never copies it) because it is not a
cross-version wire contract. The family transports read it back from the registry —
`homeDomainActionTransportV1` throws if a registered family row declares none — so the request a
host builds and the schemas it parses come from one row rather than from a hand-kept client map.
`POST /v1/actions/:actionId` stays the single generic
external entry; a per-Action server route is the Home's data operation, never a second way to
invoke the Action.

## Classes Q, M and H

The Teams-program plans classify every Action row as Q, M or H. The letters are plan shorthand;
in source each class is a combination of existing fields, so there is no `class` column to read:

| Class | Source shape | Meaning |
|---|---|---|
| **Q** (query) | `safety: 'safe'`, `requiredAuthority: 'account_automation'` | A read. Agent-exposed by default. |
| **M** (agent may propose) | `safety: 'danger'`, `requiredAuthority: 'account_automation'` | A consequential mutation an Agent may invoke, reaching human consent through the derived approval floor rather than through a refusal. |
| **H** (human only) | `requiredAuthority: 'present_user'` | Present-user only. Approval decisions and permission responses; the caller's own read-state and discussion operations; Account security, API tokens and sign-out-everywhere; plugin installation, session hooks, permission grants and secret binding; Runner activation create and cancel; and the Team identity/directory administration rows that declare it. Automation callers get `present_user_required`. |

Two consequences are worth stating because they get re-litigated. A class-H row can never reach
the public API surface, because `surfaces.api` is *derived* and requires automation authority —
that one is structural rather than a convention. Agent and MCP exposure is still authored per
row, and class-H rows author it off. And ordinary
consequential Team mutations are class M, not class H: an Action does not acquire a present-user
requirement merely because it matters. Adding one is a product decision, not a safety reflex.

## Approval is decided in one place

`resolveActionApprovalRouting` is the single approval decision. It answers three things —
whether approval is `required`, which `flow` carries it, and what `result` custody applies — and
every host consumes that answer rather than re-deriving one.

The required-ness comes from Action Settings when they are present, and otherwise from the
default floor. The floor has two inputs: `safety: 'danger'` rows are picked up automatically from
the safety declaration, and a short explicit list of non-danger *egress-sensitive* leaves
(`EGRESS_SENSITIVE_AGENT_FLOOR` — page/region/element captures, network and console summaries,
composer and agent-turn attachment, public-preview status and URL copy) is floored on the `agent`
surface because those egress page content into a turn even though they mutate nothing. That list
is reserved for non-danger egress leaves; mutating, navigating and dangerous verbs must never be
hand-added to it, because they are already classified `danger` in the specs and derived from
there.

The default floor has one present-user rule. A `present_user` invocation on the `ui` surface skips
the default danger floor, because the product UI confirms its ordinary dangerous Actions in its
own confirmation host (a destructive modal, for example) and a second, central approval would ask
twice. The CLI gets the same treatment only when its host has recorded a completed confirmation
for that exact Action (`presentUserConfirmation`). The exception is
`PRESENT_USER_UI_POLICY_CONFIRMED_ACTION_ID_SET`, currently only `session.responsibility.set`. That
row has no UI-local confirmation host, so its confirmation *is* this policy's default: it is
required by default on the present-user UI as well, and a user can waive it only in Actions
settings (teams-lane-04/11 §7.1). Do not give such a row a picker-local prompt or a domain
approval resolver. The set is listed by hand on purpose, because no spec fact separates it. Other
rows share its `safety: 'danger'` and its optional deferred approval, such as
`session.access.grant.set`. Deriving the set from those facts would also switch off the UI
suppression for all of them. Persisted per-surface overrides and waivers are evaluated before any
of this and always win.

The flow is `deferred` when the caller cannot hold a blocking waiter: the public Action API, which
reports a created approval artifact to its caller, and the present-user UI, whose mounted
continuation follows the artifact and consumes the replayed typed result. The exception is
`approvalResultCustody: 'live_only'`, where the exact invocation stays the blocking waiter because
its raw result must never become durable artifact custody; such a row must declare both a required
result and a safe observation projection, which the spec schema enforces. Two rows declare it for
a show-once bearer:

- `teams.credentials.externalKeys.create`. Its result is `{ token, key }`. The bearer token
  reaches only the live caller, and the observation projection keeps just the non-secret `key`
  summary for the artifact.
- `account.apiTokens.create`. The API token is shown once and stored only as a digest, so like
  the external key it stays on the admitted invocation and never enters approval history.

Because of this, a deferred approval of either row becomes a blocking one. If the live invocation
is lost, the result is intentionally unrecoverable: list and revoke the credential instead.
`approvalInputCustody: 'live_only'` is the input-side sibling, used for credential-bearing input
such as passwords. The artifact carries only the declared input projection from creation, and a
replay without the live invocation fails closed. Agent, CLI and MCP blocking callers are
unchanged. Approval Actions themselves (`approval.request.*`) are never approval-gated, which is
what prevents the obvious loop.

Plugin-contributed Actions follow the same split between present and non-present requesters, with
one owner per side. For a `ui` or `voice` invocation the UI dispatcher
(`apps/ui/sources/components/plugins/surfaces/pluginSurfaceActionDispatch.ts`) is the only place
that asks: it applies the shared requirement rule (`pluginActionRequiresPresentUserIntent`, which
covers a non-safe danger level, declared confirmation, and the Account's Ask-first setting), shows
the app-shell confirmation, and only then executes. A client-target Action runs through the shared
present-user gate in the UI. A daemon-target Action is sent with `presentUserIntent: 'confirmed'`
on `daemon.plugins.structuredMessages.actions.execute`. The daemon's gate admits that carried
intent and creates no `plugin_target_action` approval artifact. A request without it fails closed
with `plugin_action_current_intent_unavailable`, so a settings skew between UI and daemon refuses
rather than executes. Durable `plugin_target_action` artifacts remain only for requesters that are
not present in the app: agent, MCP, CLI, the public API and automation ingresses.

A settled artifact keeps only the declared input projection. The admitted `actionArgs` stay
immutable while the request is `open`, `approved` and `executing`, because deferred replay reads
them. On the transition into a settled state (`rejected`, `canceled`, `executed` or `failed`, which
includes a failure before execution), they are replaced by the Action's own
`projectObservationInput`, never by caller-authored arguments. One owner decides this:
`packages/protocol/src/approvals/approvalRequestTransition.ts` (`decideApprovalRequestTransition`,
`settleApprovalRequestActionArgs`). Both artifact writers consume it, the CLI/daemon approval store
and the UI approval writer, and each commits with the revision it read. Only the winner of
`approved -> executing` performs the effect.

## The CLI demotes a success that did not take effect

An Action may legitimately declare its whole outcome union as *successful output* — typed
consumers read the status field. The CLI must not print success and exit zero for such a payload,
so `ActionCliPresentation.classifyResult` exists: after `executeCommand` unwraps the canonical
success payload and handles a created approval request, it gives the presenter one chance to
demote the payload into a typed `ActionCliFailure`, which then flows through the same
`failureFields` / `describeFailure` / `reportFailure` path as every other CLI failure.

`SESSION_SEND_PRESENTATION` is the worked example. The executor has already validated the payload
against the Action's output schema, so the presenter demotes only the canonical undelivered
statuses (`rejected`, `failed`, `cancelled`, `outcomeUnknown`) and does not become a second output
validator. Each demotion carries the admission `code`; only `outcomeUnknown` — the one genuinely
uncertain case — earns the `--local-id` retry hint, and the released JSON `sent` field is derived
from the status rather than assumed.

## Related

- [api.md](api.md) — the public Action API envelope, PAT authentication, targets, and limits.
- [cli-architecture.md](cli-architecture.md) — how a spec row becomes a CLI command.
- [peer-mediation.md](peer-mediation.md) — the Machine-RPC route classes and which methods may go direct.
- [session-collaboration.md](session-collaboration.md) — the Session-side owners many of these Actions call.
