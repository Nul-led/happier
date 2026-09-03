import type { NewSessionDraftProjection } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { resolveAgentIdFromFlavor } from '@/agents/catalog/catalog';
import { t, type TranslationKey } from '@/text';

export type NewSessionDraftRowPresentation = Readonly<{
    title: string;
    statusKey: TranslationKey | null;
}>;

export type NewSessionDraftAvailabilitySummary = Readonly<{
    machineUnavailable: boolean;
    pluginUnavailable: boolean;
    attachmentNeedsAttention: boolean;
}>;

function readAuthoringValue(draft: NewSessionDraftProjection, fieldId: string): unknown {
    if (draft.document.target.kind !== 'newSession') return null;
    const authoring = draft.document.target.authoring as Readonly<Record<string, Readonly<{ value: unknown }>>>;
    return authoring[fieldId]?.value ?? null;
}

function readNonblankString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function safeFinalPathSegment(value: unknown): string | null {
    const path = readNonblankString(value);
    if (!path) return null;
    const segments = path.replace(/[\\/]+$/g, '').split(/[\\/]+/);
    return readNonblankString(segments[segments.length - 1]);
}

function firstPromptLine(value: string): string | null {
    for (const line of value.split(/\r?\n/)) {
        const promptLine = readNonblankString(line);
        if (promptLine) return promptLine;
    }
    return null;
}

function readAutomationName(draft: NewSessionDraftProjection): string | null {
    const value = readAuthoringValue(draft, 'automation');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return readNonblankString((value as Readonly<Record<string, unknown>>).name);
}

/**
 * The Agent the draft is authored against, normalized to its bundled id when it
 * names one. An installed Agent keeps its own id, and a draft that names no
 * Agent resolves to none: the row shows no mark rather than the default Agent's.
 */
export function resolveNewSessionDraftAgentId(draft: NewSessionDraftProjection): string {
    const authoredAgentId = readNonblankString(readAuthoringValue(draft, 'agentId'));
    return resolveAgentIdFromFlavor(authoredAgentId) ?? authoredAgentId ?? '';
}

function resolveStatusKey(
    draft: NewSessionDraftProjection,
    availability?: NewSessionDraftAvailabilitySummary,
): TranslationKey | null {
    if (draft.status === 'conflict') return 'sessionDrafts.status.conflict';
    if (draft.status === 'offline') return 'sessionDrafts.status.offline';
    if (availability?.machineUnavailable) return 'sessionDrafts.availability.machineUnavailable';
    if (availability?.pluginUnavailable) return 'sessionDrafts.availability.pluginUnavailable';
    if (availability?.attachmentNeedsAttention) return 'sessionDrafts.availability.attachmentNeedsAttention';
    if (draft.status === 'pending') return 'sessionDrafts.status.syncing';
    return null;
}

export function buildNewSessionDraftRowPresentation(
    draft: NewSessionDraftProjection,
    availability?: NewSessionDraftAvailabilitySummary,
): NewSessionDraftRowPresentation {
    const promptLine = firstPromptLine(draft.document.composer.text.value);
    const automationName = readAutomationName(draft);
    const folderName = safeFinalPathSegment(readAuthoringValue(draft, 'directory'));
    const title = promptLine ?? automationName ?? folderName ?? t('sessionDrafts.untitled');
    return {
        title,
        statusKey: resolveStatusKey(draft, availability),
    };
}
