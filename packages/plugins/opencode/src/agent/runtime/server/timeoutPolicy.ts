/**
 * One startup/readiness deadline for both owned and attached OpenCode servers.
 * Starting the executable and observing its healthy projection are the same
 * admission operation; a shorter downstream deadline would only abandon work
 * that the managed-service owner is still allowed to finish.
 *
 * The value is the managed-service owner's own default, not a provider guess:
 * `MANAGED_SERVICE_NUMERIC_CONTRACT.startupTimeoutMs.defaultValue` in
 * `apps/cli/src/plugins/runtime/invocation/services/managedServiceSpecNormalization.ts`.
 * Declaring it explicitly (rather than omitting it and inheriting) is what lets
 * `waitUntilHealthy` use provably the same deadline the spec was admitted with.
 * A plugin cannot import that host module, so the number is restated here and
 * pinned by `assembly.managedServices.test.ts`.
 */
export const OPEN_CODE_MANAGED_SERVER_STARTUP_TIMEOUT_MS = 30_000;

/**
 * How often a turn waiter re-polls when no provider event has woken it.
 *
 * Terminal provider events now wake waiters directly, so this interval no
 * longer paces normal turn completion — it only bounds the fallback for
 * OpenCode versions/transports that omit an idle event. The resource it
 * protects is the OpenCode HTTP server: every wake costs a `sessionStatus`
 * call and can cost a full history refresh, so the cadence is the polling load
 * Happier is willing to put on a third-party server for the whole duration of
 * an in-flight turn. `runtime.test.ts` ("backs off full history refreshes
 * while waiting for idle assistant history") pins that budget — 5s of waiting
 * must cost 3 status calls, not 21.
 */
export const OPEN_CODE_TURN_COMPLETION_FALLBACK_INTERVAL_MS = 2_000;
