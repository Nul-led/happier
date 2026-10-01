import { isExactClaudePastedTextMarker } from './pastedTextMarker.js';
import { isClaudeUnifiedComposerTextMatch } from './promptIdentity.js';
import { parseClaudeScreenState } from './screenState.js';

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function isCollapsedPastedTextComposer(composerContent: string | null): boolean {
  return composerContent !== null
    && isExactClaudePastedTextMarker(composerContent);
}

function isPromptInComposer(params: Readonly<{ promptText: string; screenText: string }>): boolean {
  const promptText = normalizeNewlines(params.promptText);
  const composerContent = parseClaudeScreenState(params.screenText).composerContent;
  // During this authorized paste, Claude may expose fewer than 256 characters
  // in a small viewport (observed with 2.1.280). Historical draft ownership
  // keeps its stronger threshold; submission must not depend on window size.
  return isCollapsedPastedTextComposer(composerContent)
    || (composerContent !== null && isClaudeUnifiedComposerTextMatch({
      promptText,
      composerText: composerContent,
      allowShortVisibleWindow: true,
    }));
}

export function createClaudePromptSubmitVerificationPolicy() {
  return {
    shouldVerifyAfterSubmit(promptText: string) {
      return normalizeNewlines(promptText).trim().length > 0;
    },
    verifyBeforeSubmitStaging: isPromptInComposer,
    verifyAfterSubmit: isPromptInComposer,
  };
}
