import type { ClaudeUnifiedTerminalLaunchIntent } from './launchIntent.js';

export function createClaudeUnifiedResumeTurnBarrier(params: Readonly<{
  intent: ClaudeUnifiedTerminalLaunchIntent;
  quietMs: number;
  begin(): void;
  cancel(reason: 'idle' | 'startup_blocked'): void;
}>): Readonly<{
  beginBeforeProviderRun(): void;
  observeProviderSessionStart(source: string | null): void;
  /** A retained conversation was observed, not launched with --resume. */
  observeRetainedProviderSession(): void;
  observeStartupBlocked(): boolean;
  observeStartupReady(): void;
  /** Consumes the first prompt belonging to the authoritative resume SessionStart. */
  observePromptStart(): boolean;
  observeTerminal(): void;
  dispose(): void;
  isActive(): boolean;
  isProvisional(): boolean;
}> {
  let state: 'none' | 'provisional' | 'confirmed' = 'none';
  let begun = false;
  let sessionStarted = false;
  let startupReady = false;
  let resumePromptPending = false;
  let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (!idleReleaseTimer) return;
    clearTimeout(idleReleaseTimer);
    idleReleaseTimer = null;
  };
  const scheduleIdleRelease = (): void => {
    if (state !== 'provisional' || !sessionStarted || !startupReady || idleReleaseTimer) return;
    idleReleaseTimer = setTimeout(() => {
      idleReleaseTimer = null;
      if (state !== 'provisional') return;
      state = 'none';
      params.cancel('idle');
    }, Math.max(0, Math.trunc(params.quietMs)));
  };
  const observeTerminal = (): void => {
    clearTimer();
    state = 'none';
    resumePromptPending = false;
  };

  return {
    beginBeforeProviderRun() {
      if (params.intent.kind !== 'resume_native' || begun || state !== 'none') return;
      begun = true;
      state = 'provisional';
      sessionStarted = false;
      startupReady = false;
      resumePromptPending = false;
      params.begin();
    },
    observeProviderSessionStart(source) {
      if (state !== 'provisional') return;
      sessionStarted = true;
      // Only an authenticated resume SessionStart authorizes the special first-prompt
      // classification. The enclosing runtime rejects a fresh-start or identity mismatch.
      resumePromptPending = source === 'resume';
      scheduleIdleRelease();
    },
    observeRetainedProviderSession() {
      if (state !== 'provisional') return;
      clearTimer();
      state = 'none';
      resumePromptPending = false;
      params.cancel('idle');
    },
    observeStartupBlocked() {
      if (state !== 'provisional' || sessionStarted) return false;
      clearTimer();
      state = 'none';
      resumePromptPending = false;
      params.cancel('startup_blocked');
      return true;
    },
    observeStartupReady() {
      if (state !== 'provisional') return;
      startupReady = true;
      scheduleIdleRelease();
    },
    observePromptStart() {
      if (!resumePromptPending) return false;
      resumePromptPending = false;
      if (state === 'provisional') {
        state = 'confirmed';
      } else if (state === 'none' && begun) {
        // Writable readiness can prove an idle resume before Claude forwards a delayed native
        // continuation hook. Re-open the canonical turn from exact SessionStart provenance rather
        // than extending the quiet-period heuristic or treating the hook as pending acceptance.
        state = 'confirmed';
        params.begin();
      }
      clearTimer();
      return true;
    },
    observeTerminal,
    dispose: observeTerminal,
    isActive: () => state !== 'none',
    isProvisional: () => state === 'provisional',
  };
}
