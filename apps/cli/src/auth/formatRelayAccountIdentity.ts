const SHORT_ACCOUNT_ID_LENGTH = 8;

function readRelayHost(serverUrl: string): string {
  const raw = String(serverUrl ?? '').trim();
  try {
    return new URL(raw).host || raw;
  } catch {
    return raw;
  }
}

/**
 * One human phrase naming which relay this computer talks to and as whom: `<host> as <account>`.
 * The account is its readable label (username or display name) and falls back to a short account
 * id, so "connected but no machine" states can say exactly which Home and account are involved.
 */
export function formatRelayAccountIdentity(params: Readonly<{
  serverUrl: string;
  accountLabel: string | null | undefined;
  accountId: string | null | undefined;
}>): string {
  const host = readRelayHost(params.serverUrl);
  const label = String(params.accountLabel ?? '').trim();
  if (label) {
    return `${host} as ${label}`;
  }
  const accountId = String(params.accountId ?? '').trim();
  if (accountId) {
    return `${host} as account ${accountId.slice(0, SHORT_ACCOUNT_ID_LENGTH)}`;
  }
  return host;
}
