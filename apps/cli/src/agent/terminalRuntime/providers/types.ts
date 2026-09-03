import type {
    HostTerminalAvailabilityRequest,
} from '@/agent/runtime/session/terminal/contract';
import type { AgentSurfaceAvailabilityV1 } from '@happier-dev/protocol';

type BivariantAsyncUnaryFn<TParams, TResult> = {
    bivarianceHack(params: TParams): Promise<TResult>;
}['bivarianceHack'];

type BivariantMaybeAsyncUnaryFn<TParams, TResult> = {
    bivarianceHack(params: TParams): TResult | Promise<TResult>;
}['bivarianceHack'];

export type TerminalRuntimeOps<
    TLaunchParams = never,
    TLaunchResult = never,
    TDiscoverIdentityParams = never,
    TDiscoverIdentityResult = never,
    TAvailabilityParams = never,
> = Readonly<{
    evaluateAvailability?: (params: TAvailabilityParams) => Promise<AgentSurfaceAvailabilityV1> | AgentSurfaceAvailabilityV1;
    launch?: (params: TLaunchParams) => Promise<TLaunchResult>;
    discoverIdentity?: (params: TDiscoverIdentityParams) => Promise<TDiscoverIdentityResult>;
}>;

export type AnyTerminalRuntimeOps = Readonly<{
    evaluateAvailability?: BivariantMaybeAsyncUnaryFn<HostTerminalAvailabilityRequest, AgentSurfaceAvailabilityV1>;
    launch?: BivariantAsyncUnaryFn<unknown, unknown>;
    discoverIdentity?: BivariantAsyncUnaryFn<unknown, unknown>;
}>;
