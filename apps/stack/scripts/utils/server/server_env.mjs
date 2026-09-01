import { resolveServerUiEnv } from './ui_env.mjs';

function resolveStackServerLogLevel({ baseEnv }) {
  const stackLevel = String(baseEnv.HAPPIER_STACK_SERVER_LOG_LEVEL ?? '').trim();
  if (stackLevel) return stackLevel;

  const serverLevel = String(baseEnv.HAPPIER_SERVER_LOG_LEVEL ?? '').trim();
  if (serverLevel) return serverLevel;

  const inheritedLevel = String(baseEnv.HAPPIER_LOG_LEVEL ?? baseEnv.LOG_LEVEL ?? '').trim();
  if (inheritedLevel) return null;

  return 'warn';
}

export function buildServerRuntimeEnv({
  baseEnv,
  serverPort,
  canonicalServerUrl = '',
  publicServerUrl,
  serveUi = false,
  uiRequired = false,
  uiBuildDir = '',
  uiBuildDirExists = false,
  uiPrefix = '/',
}) {
  const configuredCanonicalServerUrl = String(
    canonicalServerUrl || baseEnv.HAPPIER_CANONICAL_SERVER_URL || '',
  ).trim();
  const explicitLegacyPublicServerUrl = String(
    baseEnv.HAPPIER_PUBLIC_SERVER_URL_INFERRED === '1'
      ? ''
      : baseEnv.HAPPIER_PUBLIC_SERVER_URL || '',
  ).trim();
  const stableCanonicalServerUrl = configuredCanonicalServerUrl
    || explicitLegacyPublicServerUrl
    || `http://localhost:${serverPort}`;
  const nextEnv = {
    ...baseEnv,
    PORT: String(serverPort),
    HAPPIER_CANONICAL_SERVER_URL: stableCanonicalServerUrl,
    HAPPIER_PUBLIC_SERVER_URL: publicServerUrl,
    PUBLIC_URL: publicServerUrl,
    METRICS_ENABLED: baseEnv.METRICS_ENABLED ?? 'false',
  };
  const serverLogLevel = resolveStackServerLogLevel({ baseEnv });
  if (serverLogLevel) {
    nextEnv.HAPPIER_SERVER_LOG_LEVEL = serverLogLevel;
  }

  if (serveUi) {
    nextEnv.HAPPIER_SERVER_UI_REQUIRED = uiRequired ? '1' : '0';
  }

  return {
    ...nextEnv,
    ...resolveServerUiEnv({
      serveUi,
      uiBuildDir,
      uiPrefix,
      uiBuildDirExists,
    }),
  };
}
