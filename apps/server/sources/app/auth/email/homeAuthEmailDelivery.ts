import { readHomeConfigEnv } from "@/app/home/settings/homeSettings";

import type { HomeConnectionDescriptorContinuityStore } from "@/app/features/homeConnectionDescriptorContinuity";
import { resolveTeamJoinLinkTarget } from "@/app/teams/invitations/joinScreenHome";

import type { AuthEmailDelivery } from "./authEmailDelivery";
import type { ResolveAuthEmailApplicationLinkTarget } from "./nativeAuthEmailOperations";
import { createPerSendAuthEmailDelivery } from "./resolveAuthEmailDelivery";

/**
 * The composed mail delivery of this Home: SMTP settings resolved on every send from the Home's
 * effective configuration (deployment env locks, then Home settings with the sealed password),
 * so a change from the console applies to the next message without a restart (plan §3.3).
 */
export function createHomeAuthEmailDelivery(): AuthEmailDelivery {
    return createPerSendAuthEmailDelivery({ readEnv: () => readHomeConfigEnv() });
}

/**
 * Where this Home's mail links open: the web-app address and the published Home descriptor from the
 * Home-effective configuration, so an address the owner stored drives email links (plan §3.2, §3.3).
 * The caller's env is used when given (see `ResolveAuthEmailApplicationLinkTarget`).
 */
export function createHomeMailLinkTargetResolver(params: Readonly<{
    continuityStore: HomeConnectionDescriptorContinuityStore | null | undefined;
    readDescriptor?: Parameters<typeof resolveTeamJoinLinkTarget>[2];
}>): ResolveAuthEmailApplicationLinkTarget {
    return async (env) => await resolveTeamJoinLinkTarget(
        { ...(env ?? await readHomeConfigEnv()) },
        params.continuityStore,
        params.readDescriptor,
    );
}
