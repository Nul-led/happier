import { asRecord, normalizeString, readStringRecord } from './openCodeParsing.js';
import type { OpenCodeRuntimeContext } from './runtimeContext.js';
import { readCanonicalOpenCodeAgentRuntimeDescriptorV1 } from '../../identity/runtimeDescriptor.js';

export const HAPPIER_OPENCODE_SERVER_URL_ENV_KEY = 'HAPPIER_OPENCODE_SERVER_URL';
export const OPENCODE_SERVER_PASSWORD_ENV_KEY = 'OPENCODE_SERVER_PASSWORD';

export type OpenCodeServerEndpoint =
  | Readonly<{
    mode: 'external-attach';
    baseUrl: string;
    credential: null;
  }>
  | Readonly<{
    mode: 'managed-spawn';
  }>;

export function readOpenCodeSessionEnvironment(params: unknown): Readonly<Record<string, string>> {
  const record = asRecord(params);
  return Object.fromEntries(
    Object.entries(readStringRecord(asRecord(record?.isolation)?.env ?? record?.env))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export function readOpenCodeServerEndpoint(
  ctx: Pick<OpenCodeRuntimeContext, 'config'>,
  params: unknown,
): OpenCodeServerEndpoint {
  const request = asRecord(params);
  const retained = request?.kind === 'fork' || request?.kind === 'resume'
    ? readCanonicalOpenCodeAgentRuntimeDescriptorV1(request.runtimeDescriptorV1)
    : null;
  if (retained?.serverBaseUrlExplicit && retained.serverBaseUrl) {
    return {
      mode: 'external-attach',
      baseUrl: retained.serverBaseUrl.replace(/\/+$/u, ''),
      credential: null,
    };
  }
  const env = readOpenCodeSessionEnvironment(params);
  const configuration = asRecord(request?.configuration);
  const options = asRecord(configuration?.options);
  const explicitBaseUrl = normalizeString(asRecord(options?.opencodeServerBaseUrl)?.value)
    || normalizeString(env[HAPPIER_OPENCODE_SERVER_URL_ENV_KEY])
    || normalizeString(ctx.config?.values?.[HAPPIER_OPENCODE_SERVER_URL_ENV_KEY]);
  if (explicitBaseUrl) {
    return {
      mode: 'external-attach',
      baseUrl: explicitBaseUrl.replace(/\/+$/u, ''),
      credential: null,
    };
  }
  return { mode: 'managed-spawn' };
}
