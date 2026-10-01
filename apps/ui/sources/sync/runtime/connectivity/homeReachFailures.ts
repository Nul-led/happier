import * as React from 'react';

import { getPersistenceStorage, getPersistenceStorageId } from '@/sync/domains/state/persistenceStorage';

const HISTORY_KEY = 'home-reach-failures-v2';
const DISMISSED_KEY = 'home-reach-nudge-dismissed-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const RETAINED_DAYS = 7;

/** Three separate supervisor-confirmed outages in the current seven-day window. */
export const HOME_REACH_NUDGE_FAILURE_THRESHOLD = 3;

type DayBucket = Readonly<{ day: number; count: number }>;
type History = Record<string, DayBucket[]>;

const listeners = new Set<() => void>();
let revision = 0;
let dayChangeTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
    revision += 1;
    for (const listener of listeners) listener();
}

function currentDay(nowMs: number): number {
    return Math.floor(nowMs / DAY_MS);
}

function isRetainedDay(day: number, today: number): boolean {
    return day >= today - (RETAINED_DAYS - 1) && day <= today;
}

function readHistory(): History {
    const raw = getPersistenceStorage().getString(HISTORY_KEY);
    if (!raw) return Object.create(null) as History;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Object.create(null) as History;
        const history: History = Object.create(null) as History;
        for (const [homeIdentityId, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!homeIdentityId || !Array.isArray(value)) continue;
            const buckets: unknown[] = value;
            history[homeIdentityId] = buckets.filter((bucket): bucket is DayBucket =>
                bucket !== null && typeof bucket === 'object'
                && 'day' in bucket && typeof bucket.day === 'number' && Number.isSafeInteger(bucket.day)
                && 'count' in bucket && typeof bucket.count === 'number'
                && Number.isSafeInteger(bucket.count) && bucket.count > 0);
        }
        return history;
    } catch {
        return Object.create(null) as History;
    }
}

function readDismissed(): Set<string> {
    const raw = getPersistenceStorage().getString(DISMISSED_KEY);
    if (!raw) return new Set();
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return new Set();
        const ids: unknown[] = parsed;
        return new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0));
    } catch {
        return new Set();
    }
}

/** Device-local count across today and the preceding six UTC day-buckets. */
export function readRecentHomeReachFailures(homeIdentityId: string, nowMs: number): number {
    if (!homeIdentityId || !Number.isFinite(nowMs)) return 0;
    const today = currentDay(nowMs);
    return (readHistory()[homeIdentityId] ?? [])
        .filter((bucket) => isRetainedDay(bucket.day, today))
        .reduce((sum, bucket) => sum + bucket.count, 0);
}

/** The reachability supervisor alone records a failed wait episode; retries never call this writer. */
export function recordFailedHomeReach(homeIdentityId: string, nowMs: number): void {
    if (!homeIdentityId || !Number.isFinite(nowMs)) return;
    const today = currentDay(nowMs);
    const current = readHistory();
    const next: History = Object.create(null) as History;
    for (const [id, buckets] of Object.entries(current)) {
        const retained = buckets.filter((bucket) => isRetainedDay(bucket.day, today)).slice(-RETAINED_DAYS);
        if (retained.length > 0) next[id] = retained;
    }
    const buckets = next[homeIdentityId] ?? [];
    const existing = buckets.find((bucket) => bucket.day === today);
    next[homeIdentityId] = existing
        ? buckets.map((bucket) => bucket.day === today ? { day: today, count: bucket.count + 1 } : bucket)
        : [...buckets, { day: today, count: 1 }].slice(-RETAINED_DAYS);
    getPersistenceStorage().set(HISTORY_KEY, JSON.stringify(next));
    notify();
}

export function dismissHomeReachNudge(homeIdentityId: string): void {
    if (!homeIdentityId) return;
    const dismissed = readDismissed();
    if (dismissed.has(homeIdentityId)) return;
    dismissed.add(homeIdentityId);
    getPersistenceStorage().set(DISMISSED_KEY, JSON.stringify([...dismissed]));
    notify();
}

export function readHomeReachNudge(homeIdentityId: string, nowMs: number): Readonly<{ show: boolean; failureCount: number }> {
    const failureCount = readRecentHomeReachFailures(homeIdentityId, nowMs);
    return {
        show: failureCount >= HOME_REACH_NUDGE_FAILURE_THRESHOLD && !readDismissed().has(homeIdentityId),
        failureCount,
    };
}

function onWebStorage(event: StorageEvent): void {
    const prefix = `${getPersistenceStorageId()}\\`;
    if (event.key === `${prefix}${HISTORY_KEY}` || event.key === `${prefix}${DISMISSED_KEY}`) notify();
}

function scheduleDayChange(): void {
    if (dayChangeTimer !== null) clearTimeout(dayChangeTimer);
    if (listeners.size === 0) {
        dayChangeTimer = null;
        return;
    }
    dayChangeTimer = setTimeout(() => {
        dayChangeTimer = null;
        notify();
        scheduleDayChange();
    }, (currentDay(Date.now()) + 1) * DAY_MS - Date.now());
}

export function subscribeHomeReachNudge(listener: () => void): () => void {
    if (listeners.size === 0 && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('storage', onWebStorage);
    }
    listeners.add(listener);
    if (listeners.size === 1) scheduleDayChange();
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
                window.removeEventListener('storage', onWebStorage);
            }
            scheduleDayChange();
        }
    };
}

function readRevision(): number {
    return revision;
}

export function useHomeReachNudge(homeIdentityId: string): Readonly<{ show: boolean; failureCount: number }> {
    const currentRevision = React.useSyncExternalStore(subscribeHomeReachNudge, readRevision, readRevision);
    return React.useMemo(() => readHomeReachNudge(homeIdentityId, Date.now()), [homeIdentityId, currentRevision]);
}
