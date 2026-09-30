import { sanitizeConnectedServiceDiagnosticString } from '../../runtimeAuth/sanitizeConnectedServiceDiagnosticString';

export function summarizeConnectedServiceSwitchApplyError(error: unknown): string {
  if (!(error instanceof Error)) {
    return sanitizeConnectedServiceDiagnosticString(String(error)).slice(0, 300);
  }
  const code = (error as { code?: unknown }).code;
  const codePart = typeof code === 'number' || typeof code === 'string'
    ? ` (code=${String(code)})`
    : '';
  return sanitizeConnectedServiceDiagnosticString(`${error.name}${codePart}: ${error.message}`).slice(0, 400);
}
