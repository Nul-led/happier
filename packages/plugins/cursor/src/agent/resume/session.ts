export type CursorSessionLoadErrorClassification = Readonly<{
  kind: 'recoverable';
  code: 'CURSOR_SESSION_NOT_FOUND' | 'CURSOR_SESSION_LOAD_FAILED';
}>;

export type CursorResumeAction =
  | Readonly<{ action: 'load'; cursorSessionId: string }>
  | Readonly<{ action: 'new' }>;

export function classifyCursorSessionLoadError(error: unknown): CursorSessionLoadErrorClassification {
  const message = error instanceof Error ? error.message : String(error);
  if (/session\s+["'][^"']+["']\s+not\s+found/iu.test(message)) {
    return { kind: 'recoverable', code: 'CURSOR_SESSION_NOT_FOUND' };
  }
  return { kind: 'recoverable', code: 'CURSOR_SESSION_LOAD_FAILED' };
}

export function resolveCursorResumeAction(params: Readonly<{
  cursorSessionId?: string | null;
}>): CursorResumeAction {
  // Cursor minted this id and `session/load` receives it verbatim, so presence
  // is the only judgement made here -- the bytes are the identity.
  const cursorSessionId = params.cursorSessionId;
  if (typeof cursorSessionId !== 'string' || cursorSessionId.trim().length === 0) {
    return { action: 'new' };
  }
  return { action: 'load', cursorSessionId };
}
