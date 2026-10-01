import * as React from 'react';

import { API_TOKEN_EXPIRING_WINDOW_MS, readApiTokenExpiresIn } from './apiTokenSettingsPresentation';

/**
 * The page clock for token rows: it ticks exactly when a relative time ("2 h ago"), an expiring pill or
 * an expiry changes, and only while the page is actively viewed.
 */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function resolveNextRelativeTimeChangeAt(atMs: number, nowMs: number): number | null {
    if (!Number.isFinite(atMs)) return null;
    const elapsedMs = nowMs - atMs;
    if (elapsedMs < MINUTE_MS) return atMs + MINUTE_MS;

    const minutes = Math.floor(elapsedMs / MINUTE_MS);
    if (minutes < 60) return atMs + (minutes + 1) * MINUTE_MS;

    const hours = Math.floor(elapsedMs / HOUR_MS);
    if (hours < 24) return atMs + (hours + 1) * HOUR_MS;

    const days = Math.floor(elapsedMs / DAY_MS);
    return atMs + (days + 1) * DAY_MS;
}

function resolveNextApiTokenPresentationChangeAt(
    tokens: readonly Readonly<{ createdAt: string; lastUsedAt: string | null; expiresAt: string | null }>[],
    nowMs: number,
): number | null {
    let nextAt: number | null = null;
    const consider = (candidate: number | null): void => {
        if (candidate === null || !Number.isFinite(candidate) || candidate <= nowMs) return;
        nextAt = nextAt === null ? candidate : Math.min(nextAt, candidate);
    };

    for (const token of tokens) {
        consider(resolveNextRelativeTimeChangeAt(Date.parse(token.createdAt), nowMs));
        if (token.lastUsedAt) consider(resolveNextRelativeTimeChangeAt(Date.parse(token.lastUsedAt), nowMs));

        const expiresAtMs = token.expiresAt ? Date.parse(token.expiresAt) : Number.NaN;
        if (!Number.isFinite(expiresAtMs)) continue;
        if (nowMs < expiresAtMs) consider(expiresAtMs);
        // The expiring pill appears when the last seven days begin, then its "Expires in" wording
        // changes at the instant the row presentation names.
        consider(expiresAtMs - API_TOKEN_EXPIRING_WINDOW_MS);
        consider(readApiTokenExpiresIn(token.expiresAt, nowMs)?.changesAtMs ?? null);
    }

    return nextAt;
}

export function useApiTokenSettingsClock(
    tokens: readonly Readonly<{ createdAt: string; lastUsedAt: string | null; expiresAt: string | null }>[],
    active: boolean,
): number {
    const [nowMs, setNowMs] = React.useState(() => Date.now());
    const tokensRef = React.useRef(tokens);
    tokensRef.current = tokens;
    const timingKey = tokens.map((token) => [
        token.createdAt,
        token.lastUsedAt ?? '',
        token.expiresAt ?? '',
    ].join('\u001f')).join('\u001e');

    React.useEffect(() => {
        if (!active || tokensRef.current.length === 0) return undefined;

        let timeout: ReturnType<typeof setTimeout> | undefined;
        let disposed = false;
        const scheduleNextChange = () => {
            const currentNowMs = Date.now();
            setNowMs((previousNowMs) => previousNowMs === currentNowMs ? previousNowMs : currentNowMs);

            const nextAtMs = resolveNextApiTokenPresentationChangeAt(tokensRef.current, currentNowMs);
            if (nextAtMs === null || disposed) return;
            timeout = setTimeout(scheduleNextChange, Math.max(1, nextAtMs - currentNowMs + 1));
        };

        scheduleNextChange();
        return () => {
            disposed = true;
            if (timeout) clearTimeout(timeout);
        };
    }, [active, timingKey]);

    return nowMs;
}

