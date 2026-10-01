import type { Message } from "@happier-dev/session-core/messages";
import type { Settings } from '@/sync/domains/settings/settings';
import { readUnsupportedContentMeta } from "@happier-dev/session-core/messages";
import { resolveUnsupportedContentPresentation } from "@happier-dev/session-core/messages";

export type TranscriptSelectionThinkingDisplayMode = Settings['sessionThinkingDisplayMode'];

export type TranscriptSelectionMessageVisibilityOptions = Readonly<{
    sessionThinkingDisplayMode?: TranscriptSelectionThinkingDisplayMode | null;
    debugInformationEnabled?: boolean | null;
}>;

export function normalizeTranscriptSelectionThinkingVisibility(
    sessionThinkingDisplayMode: TranscriptSelectionThinkingDisplayMode | null | undefined,
): 'hidden' | 'visible' {
    return sessionThinkingDisplayMode === 'hidden' ? 'hidden' : 'visible';
}

export function shouldExcludeMessageFromTranscriptSelection(
    message: Message,
    options?: TranscriptSelectionMessageVisibilityOptions | null,
): boolean {
    if (isTranscriptSelectionHiddenUnsupportedContent(message, options?.debugInformationEnabled === true)) return true;
    return normalizeTranscriptSelectionThinkingVisibility(options?.sessionThinkingDisplayMode) === 'hidden'
        && message.kind === 'agent-text'
        && message.isThinking === true;
}

/**
 * A placeholder row that is not rendered must not stay selectable: otherwise a range selection or
 * select-all can copy a diagnostic the user cannot see.
 */
export function isTranscriptSelectionHiddenUnsupportedContent(
    message: Message,
    debugInformationEnabled: boolean,
): boolean {
    const kind = readUnsupportedContentMeta(message.meta);
    if (!kind) return false;
    return resolveUnsupportedContentPresentation({ kind, debugInformationEnabled }) === 'hidden';
}
