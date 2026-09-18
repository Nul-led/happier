import { describe, expect, it } from 'vitest';

import {
    readCodexAppServerRealtimeStartTimeoutMs,
    readCodexAppServerRequestTimeoutMs,
    readCodexAppServerResumeRecoveryTimeoutMs,
    readCodexAppServerRpcTimeoutMs,
    readCodexAppServerStartupRpcTimeoutMs,
} from './timeout';

describe('codex app-server RPC timeout policy', () => {
    it('defaults base RPC timeout to the load-tolerant 60s session-control budget', () => {
        expect(readCodexAppServerRpcTimeoutMs({})).toBe(60_000);
    });

    it('clamps base RPC timeout to the configured value when set', () => {
        expect(readCodexAppServerRpcTimeoutMs({ HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '1200' })).toBe(1200);
        expect(readCodexAppServerRpcTimeoutMs({ HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '0' })).toBe(60_000);
        expect(readCodexAppServerRpcTimeoutMs({ HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '-5' })).toBe(60_000);
        expect(readCodexAppServerRpcTimeoutMs({ HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '9999999' })).toBe(600_000);
    });

    it('keeps provider side-effecting thread, turn, and resume admission lifecycle-owned', () => {
        const env = {
            HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '1200',
            HAPPIER_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS: '20000',
        };

        expect(readCodexAppServerRequestTimeoutMs('initialize', env)).toBe(20_000);
        expect(readCodexAppServerRequestTimeoutMs('thread/start', env)).toBeNull();
        expect(readCodexAppServerRequestTimeoutMs('thread/resume', env)).toBeNull();
        expect(readCodexAppServerRequestTimeoutMs('turn/start', env)).toBeNull();
        expect(readCodexAppServerRequestTimeoutMs('turn/steer', env)).toBeNull();
        expect(readCodexAppServerRequestTimeoutMs('model/list', env)).toBe(1200);
    });

    it('bounds process initialization but not side-effecting thread admission', () => {
        expect(readCodexAppServerStartupRpcTimeoutMs({})).toBe(60_000);
        expect(readCodexAppServerRequestTimeoutMs('initialize', {})).toBe(60_000);
        expect(readCodexAppServerRequestTimeoutMs('thread/start', {})).toBeNull();
    });

    it('keeps provider-native fork requests alive without inflating ordinary RPCs', () => {
        const env = {
            HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '1200',
        };

        expect(readCodexAppServerRequestTimeoutMs('thread/fork', env)).toBeNull();
        expect(readCodexAppServerRequestTimeoutMs('conversation/fork', env)).toBeNull();
        expect(readCodexAppServerRequestTimeoutMs('model/list', env)).toBe(1200);
    });

    it('does not let the realtime-start evidence budget undercut the shared base budget', () => {
        const settlementTimeoutMs = readCodexAppServerRealtimeStartTimeoutMs({});

        expect(settlementTimeoutMs).toBe(60_000);
        expect(readCodexAppServerRequestTimeoutMs('thread/realtime/start', {}))
            .toBe(settlementTimeoutMs);
    });

    it('ensures startup timeout is never lower than the base timeout', () => {
        const env = {
            HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '25000',
            HAPPIER_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS: '20000',
        };

        expect(readCodexAppServerStartupRpcTimeoutMs(env)).toBe(25_000);
        expect(readCodexAppServerRequestTimeoutMs('initialize', env)).toBe(25_000);
    });

    it('uses a longer bounded timeout for recoverable no-history resume hydration', () => {
        expect(readCodexAppServerResumeRecoveryTimeoutMs({
            HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '250',
            HAPPIER_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS: '500',
            HAPPIER_CODEX_APP_SERVER_RESUME_RECOVERY_TIMEOUT_MS: '1200',
        })).toBe(1200);

        expect(readCodexAppServerResumeRecoveryTimeoutMs({
            HAPPIER_CODEX_APP_SERVER_RPC_TIMEOUT_MS: '25000',
            HAPPIER_CODEX_APP_SERVER_STARTUP_RPC_TIMEOUT_MS: '20000',
            HAPPIER_CODEX_APP_SERVER_RESUME_RECOVERY_TIMEOUT_MS: '1200',
        })).toBe(25_000);
    });
});
