import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import { clearNewSessionOrdinaryEntryDraftIdExact } from '@/sync/domains/settings/localOnlyAccountSettings';
import { settingsDefaults } from '@/sync/domains/settings/settings';
import { getStorage } from '@/sync/domains/state/storageStore';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import {
    captureSessionDraftCurrentness,
    captureSessionDraftLaunchCurrentness,
    clearSessionDraftCurrentness,
    clearSessionDraftLaunchCurrentness,
    getSessionDraftSnapshot,
    readSessionDraftLaunchCurrentness,
    writeExistingSessionDraft,
    type SessionDraftCurrentness,
} from '@/sync/ops/sessionDrafts/sessionDraftRepository';

function addressFor(draftId: string) {
    return { kind: 'newSession' as const, draftId };
}

export function preserveCreatedSessionDraftAfterUnacceptedFirstTurn(params: Readonly<{
    scope: ServerAccountScope | null | undefined;
    sessionId: string;
    draftText: string;
}>): void {
    const draftText = params.draftText.trim();
    if (!draftText || !params.scope) return;
    writeExistingSessionDraft({
        scope: params.scope,
        sessionId: params.sessionId,
        patch: { text: draftText },
        materializationIntent: 'seeded',
    });
}

/**
 * Re-entry may only reuse the visible draft text when it is still the exact
 * text mutation captured by the launch. A later edit remains owned by the New
 * Session draft and must never be presented as the already-accepted first turn.
 */
export function readCapturedNewSessionFirstTurnText(params: Readonly<{
    scope: ServerAccountScope;
    draftId: string;
    launchUserAttemptId: string;
}>): string | null {
    const address = addressFor(params.draftId);
    const captured = readSessionDraftLaunchCurrentness({
        scope: params.scope,
        address,
        userAttemptId: params.launchUserAttemptId,
    });
    const capturedTextMutationId = captured?.mutationIds['composer.text'] ?? null;
    if (!capturedTextMutationId) return null;
    const current = captureSessionDraftCurrentness({ scope: params.scope, address });
    if (current.mutationIds['composer.text'] !== capturedTextMutationId) {
        return null;
    }
    const textValue = getSessionDraftSnapshot(params.scope, address)?.document.composer.text?.value;
    if (typeof textValue !== 'string') return null;
    const text = textValue.trim();
    return text.length > 0 ? text : null;
}

/**
 * Captures the submitted field revisions before execution receives custody.
 * The token is local-only, but crash-stable, so terminal re-entry can clear
 * exactly those revisions without deleting edits made after submission.
 */
export function captureNewSessionDraftLaunchCurrentness(params: Readonly<{
    scope: ServerAccountScope;
    draftId: string;
    launchUserAttemptId: string;
    currentness?: SessionDraftCurrentness;
}>): SessionDraftCurrentness | null {
    const address = addressFor(params.draftId);
    return captureSessionDraftLaunchCurrentness({
        scope: params.scope,
        address,
        userAttemptId: params.launchUserAttemptId,
        ...(params.currentness ? { currentness: params.currentness } : {}),
    });
}

export function captureNewSessionDraftWorkflowCurrentness(params: Readonly<{
    scope: ServerAccountScope;
    draftId: string;
}>): SessionDraftCurrentness {
    return captureSessionDraftCurrentness({
        scope: params.scope,
        address: addressFor(params.draftId),
    });
}

/**
 * Completes launch custody by clearing only fields whose mutation ids still
 * match the submitted snapshot. Later edits remain in the same draft.
 */
export async function clearCapturedNewSessionDraftAfterLaunch(params: Readonly<{
    scope: ServerAccountScope;
    draftId: string;
    currentness?: SessionDraftCurrentness | null;
    launchUserAttemptId?: string | null;
}>): Promise<void> {
    const address = addressFor(params.draftId);
    const launchUserAttemptId = params.launchUserAttemptId?.trim() || null;
    const currentness = launchUserAttemptId
        ? readSessionDraftLaunchCurrentness({
            scope: params.scope,
            address,
            userAttemptId: launchUserAttemptId,
        })
        : params.currentness ?? null;
    if (currentness) {
        await clearSessionDraftCurrentness({ scope: params.scope, address, currentness });
    }
    if (launchUserAttemptId) {
        clearSessionDraftLaunchCurrentness({
            scope: params.scope,
            address,
            userAttemptId: launchUserAttemptId,
        });
    }
    const pointerDelta = clearNewSessionOrdinaryEntryDraftIdExact(
        getStorage().getState().settings ?? settingsDefaults,
        params.draftId,
    );
    if (pointerDelta) {
        getSyncSingleton().applySettings(pointerDelta, {
            expectedSettingsScope: params.scope,
            source: 'ui',
        });
    }
}
