import { redactBugReportSensitiveText } from '@happier-dev/protocol';

const CREDENTIAL_ENV_ASSIGNMENT = /(^|\r?\n)([A-Z][A-Z0-9_]{0,127}(?:_API_KEY|_PASSWORD|_SECRET|_TOKEN))=([^\r\n]*)/gu;

export function redactHarnessLogText(raw: string): string {
  const value = String(raw ?? '');
  if (!value) return '';
  return redactBugReportSensitiveText(value.replace(
    CREDENTIAL_ENV_ASSIGNMENT,
    (_match, prefix: string, key: string) => `${prefix}${key}=[REDACTED]`,
  ));
}
