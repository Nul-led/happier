import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import tweetnacl from 'tweetnacl';
import {
  ExternalOAuthFinalizeAuthSuccessResponseSchema,
  ExternalOAuthParamsResponseSchema,
  KeyChallengeV2IssueResponseSchema,
  canonicalizeKeyChallengeV2AudienceOrigin,
  createKeyChallengeV2SigningInput,
  encodeBase64,
} from '@happier-dev/protocol';

import { captureLoopbackOauthRedirect } from '@/cloud/loopbackOauthPkce';
import { openBrowser } from '@/ui/openBrowser';
import type { CliAccountServiceSelection } from './cliAccountServiceSession';

type RequestedMethod = Readonly<{ kind: 'key' }> | Readonly<{ kind: 'provider'; providerId: string }>;

export type CliAccountServiceAuthOutcome =
  | Readonly<{ kind: 'authenticated'; credential: Readonly<{ token: string }> }>
  | Readonly<{ kind: 'key_required' | 'update_required' | 'account_service_unavailable' | 'cancelled' | 'timed_out' | 'identity_mismatch' | 'destination_mismatch' | 'failed' }>;

type CallbackBinding = Readonly<{
  pending: string;
  purpose: string;
  credentialTarget: string;
  endpointUrl: string;
  endpointServerIdentityId: string;
  canonicalServerUrl: string;
}>;

type AuthDependencies = Readonly<{
  request?: (path: string, init?: RequestInit) => Promise<Response>;
  randomBytes?: (size: number) => Uint8Array;
  runBrowserCallback?: (input: Readonly<{
    providerId: string;
    expected: Omit<CallbackBinding, 'pending'>;
    signal?: AbortSignal;
    resolveAuthorizationUrl(callbackOrigin: string): Promise<string>;
  }>) => Promise<CallbackBinding>;
}>;

function normalizeEndpoint(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    return null;
  }
}

function defaultRequest(endpoint: string): NonNullable<AuthDependencies['request']> {
  return async (path, init) => await fetch(`${endpoint}${path}`, init);
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`Account Service request failed (${response.status})`);
  return await response.json();
}

function expectedBinding(service: CliAccountServiceSelection): Omit<CallbackBinding, 'pending'> {
  return {
    purpose: 'account_directory',
    credentialTarget: 'account_directory',
    endpointUrl: service.endpoint,
    endpointServerIdentityId: service.serverIdentityId,
    canonicalServerUrl: service.canonicalServerUrl,
  };
}

function mapError(error: unknown): CliAccountServiceAuthOutcome {
  if (error instanceof Error && error.name === 'AbortError') return { kind: 'cancelled' };
  if (error instanceof Error && /timeout/iu.test(error.message)) return { kind: 'timed_out' };
  return { kind: 'account_service_unavailable' };
}

export async function authenticateCliAccountService(
  input: Readonly<{
    service: CliAccountServiceSelection;
    method: RequestedMethod;
    key?: Uint8Array;
    signal?: AbortSignal;
    timeoutMs?: number;
  }>,
  deps: AuthDependencies = {},
): Promise<CliAccountServiceAuthOutcome> {
  const endpoint = normalizeEndpoint(input.service.endpoint);
  const canonicalOrigin = canonicalizeKeyChallengeV2AudienceOrigin(input.service.canonicalServerUrl);
  if (!endpoint || !canonicalOrigin || canonicalOrigin !== input.service.canonicalServerUrl) return { kind: 'destination_mismatch' };
  if (input.signal?.aborted) return { kind: 'cancelled' };
  const request = deps.request ?? defaultRequest(endpoint);

  try {
    if (input.method.kind === 'key') {
      if (!(input.key instanceof Uint8Array) || input.key.byteLength !== 32) return { kind: 'key_required' };
      const issue = KeyChallengeV2IssueResponseSchema.safeParse(await readJson(await request(
        '/v1/auth/account-directory/challenge',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' , signal: input.signal },
      )));
      if (!issue.success) return { kind: 'update_required' };
      if (issue.data.audience.origin !== canonicalOrigin
        || issue.data.audience.serverIdentityId !== input.service.serverIdentityId) {
        return { kind: 'identity_mismatch' };
      }
      const keyPair = tweetnacl.sign.keyPair.fromSeed(input.key);
      const signature = tweetnacl.sign.detached(createKeyChallengeV2SigningInput(issue.data), keyPair.secretKey);
      const authPayload = await readJson(await request('/v1/auth/account-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: input.signal,
        body: JSON.stringify({
          challengeId: issue.data.challengeId,
          signature: encodeBase64(signature),
          publicKey: encodeBase64(keyPair.publicKey),
        }),
      }));
      const token = typeof authPayload === 'object' && authPayload !== null && typeof (authPayload as { token?: unknown }).token === 'string'
        ? (authPayload as { token: string }).token.trim()
        : '';
      return token ? { kind: 'authenticated', credential: { token } } : { kind: 'failed' };
    }

    const providerId = input.method.providerId.trim().toLowerCase();
    if (!providerId || !input.service.advertisedMethods.oauthProviderIds.includes(providerId)) return { kind: 'update_required' };
    const proof = encodeBase64((deps.randomBytes ?? ((size) => new Uint8Array(nodeRandomBytes(size))))(32), 'base64url');
    const proofHash = createHash('sha256').update(proof).digest('hex');
    const expected = expectedBinding(input.service);
    const resolveAuthorizationUrl = async (callbackOrigin: string): Promise<string> => {
      const query = new URLSearchParams({
        mode: 'keyless', proofHash, purpose: 'account_directory',
        endpointUrl: expected.endpointUrl,
        endpointServerIdentityId: expected.endpointServerIdentityId,
        canonicalServerUrl: expected.canonicalServerUrl,
      });
      const parsed = ExternalOAuthParamsResponseSchema.safeParse(await readJson(await request(
        `/v1/auth/external/${encodeURIComponent(providerId)}/params?${query}`,
        { method: 'GET', headers: { Origin: callbackOrigin }, signal: input.signal },
      )));
      if (!parsed.success || !('purpose' in parsed.data)) throw new Error('Account Service OAuth is unsupported');
      for (const [key, value] of Object.entries(expected)) {
        if (parsed.data[key as keyof typeof expected] !== value) throw new Error('Account Service OAuth destination mismatch');
      }
      return parsed.data.url;
    };
    const callback = deps.runBrowserCallback
      ? await deps.runBrowserCallback({
          providerId,
          expected,
          ...(input.signal ? { signal: input.signal } : {}),
          resolveAuthorizationUrl,
        })
      : await captureLoopbackOauthRedirect({
          callbackPath: `/oauth/${providerId}`,
          timeoutMs: input.timeoutMs,
          signal: input.signal,
          resolveAuthorizationUrl,
          openAuthorizationUrl: async (url) => {
            if (!(await openBrowser(url))) throw new Error(`Open this URL in a browser: ${url}`);
          },
        }) as CallbackBinding;
    if (callback.endpointServerIdentityId !== expected.endpointServerIdentityId) return { kind: 'identity_mismatch' };
    if (Object.entries(expected).some(([key, value]) => callback[key as keyof typeof expected] !== value)) {
      return { kind: 'destination_mismatch' };
    }
    const finalizeResponse = await request(
      `/v1/auth/external/${encodeURIComponent(providerId)}/finalize-keyless`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pending: callback.pending, proof }), signal: input.signal },
    );
    if (!finalizeResponse.ok) {
      const failure = await finalizeResponse.json().catch(() => null) as { error?: unknown } | null;
      return typeof failure?.error === 'string' && /key|e2ee/iu.test(failure.error)
        ? { kind: 'key_required' }
        : { kind: 'account_service_unavailable' };
    }
    const finalized = ExternalOAuthFinalizeAuthSuccessResponseSchema.safeParse(await finalizeResponse.json());
    return finalized.success
      ? { kind: 'authenticated', credential: { token: finalized.data.token } }
      : { kind: 'key_required' };
  } catch (error) {
    return mapError(error);
  }
}
