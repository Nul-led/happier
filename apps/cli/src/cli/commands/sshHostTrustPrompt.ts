import { parseSshTrustPromptData, type SystemTaskJsonObject } from '@happier-dev/protocol';

/** The two host-identity prompts an SSH system task can raise. */
export type SshHostTrustPromptKind = 'ssh.trustHost' | 'ssh.replaceHostKey';

export type SshHostTrustPrompt = Readonly<{
  kind: SshHostTrustPromptKind;
  data: SystemTaskJsonObject;
}>;

export function isSshHostTrustPromptKind(kind: string): kind is SshHostTrustPromptKind {
  return kind === 'ssh.trustHost' || kind === 'ssh.replaceHostKey';
}

/**
 * The prompt as a human reads it. A replacement prompt shows both the pinned and
 * the presented fingerprint, so the difference is visible before the answer.
 */
export function formatSshHostTrustPrompt(prompt: SshHostTrustPrompt, fallbackMessage = ''): string {
  const parsed = parseSshTrustPromptData(prompt.kind, prompt.data);
  return [
    fallbackMessage || (prompt.kind === 'ssh.replaceHostKey'
      ? 'The SSH host key for this host changed.'
      : 'Trust remote SSH host key?'),
    parsed?.host ? `Host: ${parsed.host}` : '',
    parsed?.keyType ? `Key type: ${parsed.keyType}` : '',
    parsed?.fingerprint ? `Fingerprint: ${parsed.fingerprint}` : '',
    parsed?.existingFingerprint ? `Existing fingerprint: ${parsed.existingFingerprint}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * The single CLI policy for an SSH host-identity prompt, shared by
 * `happier machine setup` and every `happier home` command that reaches a host
 * over SSH.
 *
 * `--yes` means what `StrictHostKeyChecking=accept-new` means: an unknown host
 * is trusted on first use, and a *changed* pinned key is never accepted
 * unattended — that is the case where the key on the wire may not belong to the
 * intended host at all, and the operation that follows installs or ships Home
 * authority. Accepting a replacement therefore takes an interactive
 * confirmation, or the exact `--trusted-host-key` line, which the host-trust
 * resolver matches without raising a prompt at all.
 */
export async function answerSshHostTrustPrompt(params: Readonly<{
  prompt: SshHostTrustPrompt;
  assumeYes: boolean;
  interactive: boolean;
  /** The task's own prompt message, when it supplied one. */
  message?: string;
  confirm: (message: string) => Promise<boolean>;
}>): Promise<Readonly<{ trusted: boolean }>> {
  const message = formatSshHostTrustPrompt(params.prompt, params.message ?? '');
  if (params.prompt.kind === 'ssh.replaceHostKey' && params.assumeYes) {
    console.error([
      message,
      'Refusing the changed host key: --yes trusts a host on first use, never a replacement.',
      'Confirm it in an interactive terminal, or pass the exact new known_hosts line with --trusted-host-key.',
    ].join('\n'));
    return { trusted: false };
  }
  if (params.assumeYes) return { trusted: true };
  if (!params.interactive) return { trusted: false };
  return { trusted: await params.confirm(message) };
}

/** `--trusted-host-key <known_hosts line>`, the non-interactive exact pin. */
export function normalizeTrustedHostKeyFlag(value: string | null | undefined): string {
  const trusted = value?.trim() ?? '';
  if (trusted && (trusted.includes('\n') || trusted.includes('\r'))) {
    throw Object.assign(
      new Error('Invalid --trusted-host-key: expected a single known_hosts line'),
      { code: 'invalid_params' },
    );
  }
  return trusted;
}
