import { db } from "@/storage/db";
import { log } from "@/utils/logging/log";

import { listSessionBadgeRefreshPushAccountIds } from "@/app/session/personal/backgroundDelivery";

import { sendAccountExpoPushMessages, type AccountPushDelivery } from "./accountPushTransport";
import { computeAccountActivityBadgeCounts } from "./accountActivityBadge";

const BADGE_REFRESH_COALESCE_MS = 25;
const pendingBadgeRefreshAccountIds = new Set<string>();
let pendingBadgeRefreshTimer: NodeJS.Timeout | null = null;

function scheduleCoalescedBadgeRefresh(accountIds: ReadonlyArray<string>): void {
    for (const accountId of accountIds) {
        if (typeof accountId === "string" && accountId.trim().length > 0) {
            pendingBadgeRefreshAccountIds.add(accountId);
        }
    }
    if (pendingBadgeRefreshAccountIds.size === 0 || pendingBadgeRefreshTimer !== null) return;
    pendingBadgeRefreshTimer = setTimeout(() => {
        pendingBadgeRefreshTimer = null;
        const accountIdsToRefresh = [...pendingBadgeRefreshAccountIds];
        pendingBadgeRefreshAccountIds.clear();
        void refreshAccountActivityBadgePushes({ accountIds: accountIdsToRefresh }).catch((error) => {
            log({ module: "activity-badges", level: "warn" }, "failed to refresh coalesced badge pushes", error);
        });
    }, BADGE_REFRESH_COALESCE_MS);
}

export async function refreshAccountActivityBadgePushes(params: Readonly<{ accountIds: ReadonlyArray<string> }>): Promise<void> {
    const accountIds = [...new Set(params.accountIds.filter((accountId) => typeof accountId === "string" && accountId.trim().length > 0))];
    if (accountIds.length === 0) return;

    const pushTokens = await db.accountPushToken.findMany({
        where: { accountId: { in: accountIds } },
        select: { accountId: true, token: true },
    });
    if (pushTokens.length === 0) return;

    const badgeCounts = await computeAccountActivityBadgeCounts(accountIds);

    const deliveries: AccountPushDelivery[] = [];
    for (const pushToken of pushTokens) {
        deliveries.push({
            accountId: pushToken.accountId,
            token: pushToken.token,
            message: {
                to: pushToken.token,
                badge: badgeCounts.get(pushToken.accountId) ?? 0,
                data: { type: "badge_refresh" },
            },
        });
    }

    await sendAccountExpoPushMessages(deliveries, "activity-badges");
}

/**
 * Schedules the existing coalesced badge refresh for an exact Account set.
 * Recipient selection belongs to the personal candidate owner; this function
 * only batches and transports.
 */
export function scheduleAccountActivityBadgeRefresh(params: Readonly<{
    badgeAttentionChanged: boolean;
    accountIds: ReadonlyArray<string>;
}>): void {
    if (!params.badgeAttentionChanged) return;
    scheduleCoalescedBadgeRefresh(params.accountIds);
}

/**
 * The Session-scoped replacement for the removed projection-recipient helper.
 * Badge refresh follows the exact owner-or-active-Follow tracking relation
 * rather than every Account that can read the Session, so broad Team access can
 * no longer become badge fanout (L09B-R6), and the personal owner admits those
 * recipients through the one background-delivery decision — the push's arrival
 * says this Session changed, so an unqualified restricted-Team follower is not
 * a recipient at all rather than a recipient of a withheld count.
 */
export async function refreshTrackedSessionAccountBadgePushes(params: Readonly<{
    badgeAttentionChanged: boolean;
    sessionId: string;
}>): Promise<void> {
    if (!params.badgeAttentionChanged) return;
    const accountIds = await listSessionBadgeRefreshPushAccountIds(params.sessionId);
    scheduleCoalescedBadgeRefresh(accountIds);
}
