import type { StoredCredentials } from '@/persistence';
import type { AccountEncryptionCurrentnessResponse } from '@happier-dev/protocol';
import type { CliServerFeaturesSnapshot } from '@/features/serverFeaturesClient';
import { fetchAccountEncryptionCurrentness } from '@/api/client/connectedServiceCredentialApi';
import type {
    SessionEncryptionContext,
    SessionStoredContentEncryptionMode,
} from '@/session/transport/encryption/sessionEncryptionContext';
import {
    resolveSessionEncryptionContextFromCredentials,
    resolveSessionStoredContentEncryptionMode,
} from '@/session/transport/encryption/sessionEncryptionContext';
import { type ResolveSessionIdResult, resolveSessionIdOrPrefix } from '@/session/query/resolveSessionId';
import { fetchSessionById, type RawSessionRecord } from '@/session/transport/http/sessionsHttp';

export type ResolveSessionTransportContextResult =
    | {
          ok: true;
          sessionId: string;
          rawSession: RawSessionRecord;
          accountEncryptionCurrentness: AccountEncryptionCurrentnessResponse;
          ctx: null;
          mode: 'plain';
      }
    | {
          ok: true;
          sessionId: string;
          rawSession: RawSessionRecord;
          accountEncryptionCurrentness: AccountEncryptionCurrentnessResponse;
          ctx: SessionEncryptionContext;
          mode: 'e2ee';
      }
    | {
          ok: false;
          code:
              | Extract<ResolveSessionIdResult, { ok: false }>['code']
              | 'encryption_material_unavailable';
          candidates?: string[];
          sessionId?: string;
      };

async function fetchSessionTransportRecord(params: Readonly<{
    credentials: StoredCredentials;
    sessionId: string;
    resolveAuthorizationHeaders?: (request: Readonly<{
        method: 'GET' | 'POST'; path: string; body?: unknown;
    }>) => Readonly<Record<string, string>> | null;
    signal?: AbortSignal;
    serverFeaturesSnapshot?: CliServerFeaturesSnapshot;
}>): Promise<RawSessionRecord | null> {
    params.signal?.throwIfAborted();
    return await fetchSessionById({
        token: params.credentials.token,
        sessionId: params.sessionId,
        ...(params.resolveAuthorizationHeaders
            ? { resolveAuthorizationHeaders: params.resolveAuthorizationHeaders }
            : {}),
        ...(params.signal ? { signal: params.signal } : {}),
        ...(params.serverFeaturesSnapshot ? { serverFeaturesSnapshot: params.serverFeaturesSnapshot } : {}),
    });
}

export async function resolveSessionTransportContext(params: Readonly<{
    credentials: StoredCredentials;
    idOrPrefix: string;
    resolveAuthorizationHeaders?: (request: Readonly<{
        method: 'GET' | 'POST'; path: string; body?: unknown;
    }>) => Readonly<Record<string, string>> | null;
    signal?: AbortSignal;
    /** Snapshot already bound to this exact Home; this owner never probes for one. */
    serverFeaturesSnapshot?: CliServerFeaturesSnapshot;
}>): Promise<ResolveSessionTransportContextResult> {
    params.signal?.throwIfAborted();
    const currentnessAuthorizationHeaders = params.resolveAuthorizationHeaders?.({
        method: 'GET', path: '/v1/account/encryption/currentness',
    });
    if (params.resolveAuthorizationHeaders && !currentnessAuthorizationHeaders) {
        throw new Error('External Action authorization unavailable');
    }
    const accountEncryptionCurrentness = await fetchAccountEncryptionCurrentness({
        token: params.credentials.token,
        ...(currentnessAuthorizationHeaders
            ? { authorizationHeaders: currentnessAuthorizationHeaders }
            : {}),
        ...(params.signal ? { signal: params.signal } : {}),
    });
    params.signal?.throwIfAborted();
    const resolved = await resolveSessionIdOrPrefix({
        credentials: params.credentials,
        idOrPrefix: params.idOrPrefix,
        ...(params.resolveAuthorizationHeaders
            ? { resolveAuthorizationHeaders: params.resolveAuthorizationHeaders }
            : {}),
        ...(params.signal ? { signal: params.signal } : {}),
        ...(params.serverFeaturesSnapshot ? { serverFeaturesSnapshot: params.serverFeaturesSnapshot } : {}),
        accountEncryptionMode: accountEncryptionCurrentness.mode,
    });
    if (!resolved.ok) {
        return {
            ok: false,
            code: resolved.code,
            ...(resolved.candidates ? { candidates: resolved.candidates } : {}),
        };
    }

    const rawSessionPromise = resolved.rawSession
        ? Promise.resolve(resolved.rawSession)
        : fetchSessionTransportRecord({
            credentials: params.credentials,
            sessionId: resolved.sessionId,
            ...(params.resolveAuthorizationHeaders
                ? { resolveAuthorizationHeaders: params.resolveAuthorizationHeaders }
                : {}),
            ...(params.signal ? { signal: params.signal } : {}),
            ...(params.serverFeaturesSnapshot ? { serverFeaturesSnapshot: params.serverFeaturesSnapshot } : {}),
        });
    const rawSession = await rawSessionPromise;
    params.signal?.throwIfAborted();
    if (!rawSession) {
        return {
            ok: false,
            code: 'session_not_found',
            sessionId: resolved.sessionId,
        };
    }

    const mode = resolveSessionStoredContentEncryptionMode(rawSession);
    if (mode === 'plain') {
        return {
            ok: true,
            sessionId: resolved.sessionId,
            rawSession,
            accountEncryptionCurrentness,
            ctx: null,
            mode,
        };
    }
    const ctx = resolveSessionEncryptionContextFromCredentials(
        params.credentials,
        rawSession,
    );
    if (!ctx) {
        return {
            ok: false,
            code: 'encryption_material_unavailable',
            sessionId: resolved.sessionId,
        };
    }

    return {
        ok: true,
        sessionId: resolved.sessionId,
        rawSession,
        accountEncryptionCurrentness,
        ctx,
        mode,
    };
}
