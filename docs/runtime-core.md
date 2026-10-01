# Agent runtime ownership

The host owns the executable Session and turn lifecycle. An Agent plugin supplies its native protocol, correlation and evidence through the public SDK; the host admits input, coordinates work, publishes lifecycle and writes the canonical transcript. Session interaction and finite Execution Runs use that same ownership boundary.

This page describes **0.3 development source**, not a shipped release or a completed live-validation gate. It is the standing architecture reference; approved plans remain the execution contract for their assigned work.

## Native Agent seam

[`AgentRuntime`](../packages/plugin-sdk/src/agentRuntime/runtime.ts) has two mutually exclusive forms: a Session factory or an execution-only Run factory. A Session-capable Agent does not supply a second finite Run implementation. The host binds its Session runtime into the shared Execution Run adapter in [`nativeAgentExecutionRun.ts`](../apps/cli/src/agent/runtime/bridges/executionRun/nativeAgentExecutionRun.ts). The shared SDK implementation in [`executionRun.ts`](../packages/plugin-sdk/src/agentRuntime/executionRun.ts) owns correlated Run events, cancellation, terminalization and disposal for the finite/conversation adapters.

The engine registry's [`runtimeCore.ts`](../apps/cli/src/agent/runtime/registry/engineRegistry/runtimeCore.ts) resolves the admitted Agent runtime and composes host services. Agent code receives the scoped public context, not raw host lifecycle controls. Agent-native configuration in `RuntimeDescriptorV1.agent` is interpreted by its Agent; generic host code must not infer its meaning from an Agent id.

## Session path and owners

| Responsibility | Canonical host owner |
| --- | --- |
| Session construction, runtime/context binding and startup | [`runHostSessionRuntime.ts`](../apps/cli/src/agent/runtime/session/loop/runHostSessionRuntime.ts) |
| Runtime event subscription, effective thinking, keepalive, mode orchestration and cleanup | [`session/loop/lifecycle.ts`](../apps/cli/src/agent/runtime/session/loop/lifecycle.ts) |
| Input pumping, permission-mode application, prompt admission and turn execution | [`runPermissionModePromptLoop.ts`](../apps/cli/src/agent/runtime/runPermissionModePromptLoop.ts) |
| Accepted turn facts and lifecycle publication | [`session/turn/lifecycle.ts`](../apps/cli/src/agent/runtime/session/turn/lifecycle.ts) |
| Runtime event validation and stream publication | [`agentSessionRuntimeEventStream.ts`](../apps/cli/src/agent/runtime/session/events/agentSessionRuntimeEventStream.ts) |
| Transcript event projection | [`projectRuntimeTranscriptEvent.ts`](../apps/cli/src/agent/runtime/session/transcripts/projectRuntimeTranscriptEvent.ts) |

The lifecycle owner consumes validated `AgentSessionRuntimeEvent` evidence, projects turn/transcript facts and supplies the prompt loop's thinking setter. The strict event union is owned by [`runtime/agentSessionV1.ts`](../packages/protocol/src/runtime/agentSessionV1.ts); [`plugins/events/hostV1.ts`](../packages/protocol/src/plugins/events/hostV1.ts) validates Host Event payloads through that same schema. Native callbacks do not become a second host state machine. Historical replay/follow and external-session discovery remain distinct from live input and transcript publication; they must not start another prompt loop or durable transcript writer.

Agent-specific protocol leaves live in `packages/plugins/<agentId>/src/agent/**`. Shared ACP composition, process/terminal transport and host lifecycle stay generic in the CLI. Detection, installation and process launch follow [binary runtime](binary-runtime.md); model-source selection and materialization follow [Providers](providers.md).

## Rules for changes

- Extend the owning host path and migrate its callers together. Do not add another Agent registry, lifecycle loop, prompt queue, permission owner, thinking flag or whole-metadata state writer.
- Use the canonical `AgentSessionRuntimeEvent` schema at ingress and its public SDK projection. Host lifecycle/session/runtime event namespaces are host-emitted; a plugin emits native evidence through the admitted Agent seam.
- Keep terminal/remote mode orchestration and cleanup at the host. An Agent declares its surfaces and native operations rather than choosing host policy.
- Keep UI activity and transcript views as projections of canonical facts. Retained UI data during refresh is not authority to admit new work.
- Retired public surfaces such as `RuntimeCoreV1`, `AcpSessionRuntimeV1`, `RuntimeControlContribution` and `RuntimeEventV1` must not regain consumers. [`agentRuntimeSurfaceContract.ts`](../packages/plugin-sdk/src/agentRuntimeSurfaceContract.ts) records the negative public contracts. Preserve a necessary released compatibility translator only at its seam, under [compatibility](compatibility.md#sdk-protocol-evolution).

## Related

[Plugin platform and SDK](plugin-platform.md), [Agent catalog](agents-catalog.md), [CLI architecture](cli-architecture.md), [Actions](actions.md), [encryption](encryption.md), [testing](testing.md).
