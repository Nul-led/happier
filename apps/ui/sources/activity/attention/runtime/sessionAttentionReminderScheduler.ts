import * as React from 'react';
import { AppState } from 'react-native';
import type { SessionAttentionStanding } from '@happier-dev/protocol';

import { sessionAddressKey, type SessionAddress } from '@/sync/domains/session/sessionAddress';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type SessionAttentionReminderDeadline = Readonly<{
    address: SessionAddress;
    remindAt: number;
}>;

export function resolveSessionAttentionReminderDeadline(
    serverId: string,
    standing: SessionAttentionStanding,
): SessionAttentionReminderDeadline | null {
    if (typeof standing.remindAt !== 'number' || !Number.isFinite(standing.remindAt)) return null;
    return {
        address: { serverId, sessionId: standing.sessionId },
        remindAt: standing.remindAt,
    };
}

export function resolveSessionAttentionReminderRefreshPlan(params: Readonly<{
    nowMs: number;
    reminders: readonly SessionAttentionReminderDeadline[];
}>): Readonly<{
    due: readonly SessionAttentionReminderDeadline[];
    nextDeadlineAt: number | null;
}> {
    const due: SessionAttentionReminderDeadline[] = [];
    let nextDeadlineAt: number | null = null;

    for (const reminder of params.reminders) {
        if (reminder.remindAt <= params.nowMs) {
            due.push(reminder);
            continue;
        }
        nextDeadlineAt = nextDeadlineAt === null
            ? reminder.remindAt
            : Math.min(nextDeadlineAt, reminder.remindAt);
    }

    return { due, nextDeadlineAt };
}

function reminderToken(reminder: SessionAttentionReminderDeadline): string {
    return JSON.stringify([sessionAddressKey(reminder.address), reminder.remindAt]);
}

function removeServerTokens(
    tokens: Set<string>,
    reminders: readonly SessionAttentionReminderDeadline[],
    serverId: string,
): void {
    for (const reminder of reminders) {
        if (reminder.address.serverId === serverId) tokens.delete(reminderToken(reminder));
    }
}

/**
 * Owns wall-clock invalidation for the server-projected `reminder_due` fact.
 * Attention meaning stays Protocol/server-owned: this hook only wakes the
 * exact Session projection when a persisted deadline can have crossed.
 */
export function useSessionAttentionReminderRefresh(params: Readonly<{
    connectedByServerId: Readonly<Record<string, boolean>>;
    /**
     * The exact-Home invalidation leaf's own contract: its promise covers the
     * replacement the controller queues behind an in-flight request. This hook
     * has no settlement obligation of its own — a due reminder is completed by
     * `refreshSession` — so the call site discards it with an explicit `void`.
     */
    invalidateSessionListQueryHome: (serverId: string) => Promise<void>;
    refreshReminderInventory: (serverId: string) => Promise<unknown>;
    refreshSession: (address: SessionAddress) => Promise<unknown>;
    reminders: readonly SessionAttentionReminderDeadline[];
}>): void {
    const [wakeRevision, setWakeRevision] = React.useState(0);
    const completedTokensRef = React.useRef(new Set<string>());
    const inFlightTokensRef = React.useRef(new Set<string>());
    const refreshedInventoryServerIdsRef = React.useRef(new Set<string>());
    const inventoryRefreshInFlightServerIdsRef = React.useRef(new Set<string>());
    const previousConnectivityRef = React.useRef<Readonly<Record<string, boolean>>>({});

    React.useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState) => {
            if (nextState !== 'active') return;
            completedTokensRef.current.clear();
            refreshedInventoryServerIdsRef.current.clear();
            setWakeRevision((value) => value + 1);
        });
        return () => subscription.remove();
    }, []);

    React.useEffect(() => {
        const currentTokens = new Set(params.reminders.map(reminderToken));
        for (const token of completedTokensRef.current) {
            if (!currentTokens.has(token)) completedTokensRef.current.delete(token);
        }

        const previousConnectivity = previousConnectivityRef.current;
        for (const [serverId, connected] of Object.entries(params.connectedByServerId)) {
            if (!connected && previousConnectivity[serverId] === true) {
                removeServerTokens(completedTokensRef.current, params.reminders, serverId);
                refreshedInventoryServerIdsRef.current.delete(serverId);
            }
            if (connected && previousConnectivity[serverId] === false) {
                refreshedInventoryServerIdsRef.current.delete(serverId);
            }
        }
        previousConnectivityRef.current = params.connectedByServerId;

        // The keys are the app-global known-Home inventory. A false value only
        // prevents due Session refresh; it must not hide an offscreen Home's
        // persisted deadline from the one shared clock.
        for (const serverId of Object.keys(params.connectedByServerId)) {
            if (refreshedInventoryServerIdsRef.current.has(serverId)
                || inventoryRefreshInFlightServerIdsRef.current.has(serverId)) {
                continue;
            }
            inventoryRefreshInFlightServerIdsRef.current.add(serverId);
            void params.refreshReminderInventory(serverId).then(
                () => {
                    inventoryRefreshInFlightServerIdsRef.current.delete(serverId);
                    refreshedInventoryServerIdsRef.current.add(serverId);
                },
                () => {
                    inventoryRefreshInFlightServerIdsRef.current.delete(serverId);
                },
            );
        }

        const nowMs = Date.now();
        const plan = resolveSessionAttentionReminderRefreshPlan({ nowMs, reminders: params.reminders });
        for (const reminder of plan.due) {
            if (params.connectedByServerId[reminder.address.serverId] !== true) continue;
            const token = reminderToken(reminder);
            if (completedTokensRef.current.has(token) || inFlightTokensRef.current.has(token)) continue;
            inFlightTokensRef.current.add(token);
            void params.invalidateSessionListQueryHome(reminder.address.serverId);
            void params.refreshSession(reminder.address).then(
                () => {
                    inFlightTokensRef.current.delete(token);
                    completedTokensRef.current.add(token);
                },
                () => {
                    inFlightTokensRef.current.delete(token);
                },
            );
        }

        if (plan.nextDeadlineAt === null) return undefined;
        const timeout = setTimeout(
            () => setWakeRevision((value) => value + 1),
            Math.min(MAX_TIMER_DELAY_MS, Math.max(1, plan.nextDeadlineAt - nowMs)),
        );
        return () => clearTimeout(timeout);
    }, [params.connectedByServerId, params.invalidateSessionListQueryHome, params.refreshReminderInventory, params.refreshSession, params.reminders, wakeRevision]);
}
