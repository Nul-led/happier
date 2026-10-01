export type SessionGoalExecutionCapabilities = Readonly<{
    canSet: boolean;
    canClear: boolean;
}>;

type SessionGoalRuntimeLike = Readonly<{
    active?: boolean;
    agentState?: Readonly<{
        capabilities?: Readonly<{
            sessionGoalSetSupported?: boolean | null;
            sessionGoalClearSupported?: boolean | null;
        }> | null;
    }> | null;
}>;

type SessionGoalMachineLike = Readonly<{
    metadata?: Readonly<{
        daemonSessionGoalControlsSupported?: boolean | null;
    }> | null;
}> | null | undefined;

const NO_SESSION_GOAL_EXECUTION_CAPABILITIES: SessionGoalExecutionCapabilities = {
    canSet: false,
    canClear: false,
};

export function resolveMachineSessionGoalExecutionCapabilities(
    machine: SessionGoalMachineLike,
): SessionGoalExecutionCapabilities {
    if (machine?.metadata?.daemonSessionGoalControlsSupported !== true) {
        return NO_SESSION_GOAL_EXECUTION_CAPABILITIES;
    }
    return { canSet: true, canClear: true };
}

/** The opened runtime publishes goal controls of its own (all or some of set/clear). */
export function hasRuntimeSessionGoalControls(session: SessionGoalRuntimeLike): boolean {
    if (session.active !== true) return false;
    const capabilities = session.agentState?.capabilities;
    return capabilities?.sessionGoalSetSupported === true || capabilities?.sessionGoalClearSupported === true;
}

/**
 * Who executes goal changes. An opened runtime with goal controls of its own executes them; otherwise
 * — a closed session, or an opened runtime without goal controls — the daemon holds the goal (its
 * goal router falls back to the inactive adapter), and Keep going is that session's continuation
 * owner (F5/X16).
 */
export function resolveSessionGoalExecutionCapabilities(input: Readonly<{
    session: SessionGoalRuntimeLike;
    machine?: SessionGoalMachineLike;
}>): SessionGoalExecutionCapabilities {
    if (!hasRuntimeSessionGoalControls(input.session)) {
        return resolveMachineSessionGoalExecutionCapabilities(input.machine);
    }
    const capabilities = input.session.agentState?.capabilities;
    return {
        canSet: capabilities?.sessionGoalSetSupported === true,
        canClear: capabilities?.sessionGoalClearSupported === true,
    };
}

/**
 * Whether the session's opened runtime continues toward its own goal: it exposes native direct goal
 * controls (S0-D's per-open signal). This is the Goal control's one continuation-owner decision (X16;
 * the daemon reports the same fact as `nativeGoalOwner`). A closed session has no opened runtime, so
 * Happier's Keep going is its owner until a runtime with native goals opens.
 */
export function resolveSessionNativeGoalOwner(session: SessionGoalRuntimeLike): boolean {
    if (session.active !== true) return false;
    const capabilities = session.agentState?.capabilities;
    return capabilities?.sessionGoalSetSupported === true && capabilities?.sessionGoalClearSupported === true;
}
