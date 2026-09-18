import { useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { sync } from '@/sync/sync';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { clearForkInitialPromptV1, readForkInitialPromptV1 } from '@/sync/domains/sessionFork/forkInitialPromptV1';
import {
    clearSessionInitialPromptV1,
    readSessionInitialPromptV1,
    type SessionInitialPromptV1,
} from '@/sync/domains/sessionInitialPrompt/sessionInitialPromptV1';
import { containsLikelyNonWhitespace, isLargeTextInputValueLength } from '@/components/ui/forms/largeTextInputPolicy';
import { useWebLifecycleFlush } from './useWebLifecycleFlush';
import { readSessionOwnerMetadataView } from '@/sync/domains/session/readSessionOwnerMetadataView';
import type { ServerAccountScopeLifetime } from '@/sync/domains/scope/serverAccountScope';
import type { Session } from '@/sync/domains/state/storageTypes';
import {
    flushSessionDraft,
    getSessionDraftSnapshot,
    subscribeSessionDraft,
    writeExistingSessionDraft,
} from '@/sync/ops/sessionDrafts/sessionDraftRepository';

interface UseDraftOptions {
    /** Exact route credential authority. A missing or retired lifetime is local-only. */
    accountLifetime: ServerAccountScopeLifetime | null;
    /** Exact Session projection selected by the route owner. */
    session: Session | null;
    autoSaveInterval?: number; // in milliseconds, default 2000
    active?: boolean;
    /**
     * The existing Session composer may advance its semantic revision as soon
     * as visible text changes. The debounced persistence write receives the
     * returned token so that one edit cannot advance the same revision twice.
     */
    onTextMutation?: (input: Readonly<{
        sessionId: string;
        text: string;
    }>) => unknown;
}

export type SessionDraftTextSnapshot = Readonly<{
    sessionId: string;
    text: string;
}>;

function normalizeSessionId(sessionId: string | null | undefined): string | null {
    const normalizedSessionId = String(sessionId ?? '').trim();
    return normalizedSessionId.length > 0 ? normalizedSessionId : null;
}

export function useDraft(
    sessionId: string | null | undefined,
    value: string,
    onChange: (value: string) => void,
    options: UseDraftOptions,
) {
    const { autoSaveInterval = 2000 } = options;
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastSavedValue = useRef<string>('');
    const lastSessionId = useRef<string | null>(null);
    const latestValue = useRef<string>(value);
    const autosaveSkip = useRef<Readonly<{ sessionId: string; value: string }> | null>(null);
    const routeFocused = useIsFocused();
    const active = options.active ?? routeFocused;
    const accountLifetime = options.accountLifetime;
    const draftScope = accountLifetime?.isCurrent() === true ? accountLifetime.scope : null;
    const isDraftOwnerCurrent = useCallback(() => (
        accountLifetime !== null && accountLifetime.isCurrent()
    ), [accountLifetime]);
    const resolvedSessionId = normalizeSessionId(sessionId);
    const session = resolvedSessionId ? options.session : null;
    const repositoryDraft = resolvedSessionId && draftScope
        ? getSessionDraftSnapshot(draftScope, { kind: 'session', sessionId: resolvedSessionId })
        : null;
    const storedDraft = typeof repositoryDraft?.document.composer.text.value === 'string'
        ? repositoryDraft.document.composer.text.value
        : null;
    const ownerMetadata = session ? readSessionOwnerMetadataView(session) : null;
    const forkInitialPrompt = readForkInitialPromptV1(ownerMetadata);
    const forkInitialPromptText = forkInitialPrompt?.text ?? null;
    const sessionInitialPrompt = readSessionInitialPromptV1(ownerMetadata);
    const consumedSessionInitialPromptKeyRef = useRef<string | null>(null);
    const sessionInitialPromptKey = useMemo(() => {
        if (!resolvedSessionId || !sessionInitialPrompt) return null;
        return [
            resolvedSessionId,
            sessionInitialPrompt.mode,
            String(sessionInitialPrompt.createdAtMs),
            sessionInitialPrompt.sourceSessionId ?? '',
            (sessionInitialPrompt.sourceMessageIds ?? []).join(','),
            sessionInitialPrompt.source ? JSON.stringify(sessionInitialPrompt.source) : '',
            sessionInitialPrompt.text,
        ].join('\u0000');
    }, [resolvedSessionId, sessionInitialPrompt]);
    const activeSessionInitialPrompt = sessionInitialPromptKey && consumedSessionInitialPromptKeyRef.current !== sessionInitialPromptKey
        ? sessionInitialPrompt
        : null;

    // Exact hydration follows the active composer rather than the one-shot session-visible
    // callback. That makes a warm session retry as soon as its account scope becomes available,
    // while Sync remains the only owner of transport readiness, decryption, and reconciliation.
    useEffect(() => {
        if (!active || !draftScope || !accountLifetime || !resolvedSessionId || !isDraftOwnerCurrent()) return;
        fireAndForget(sync.materializeExistingSessionDraft(resolvedSessionId, accountLifetime), {
            tag: 'useDraft.materializeExistingSessionDraft',
        });
    }, [accountLifetime, active, draftScope, isDraftOwnerCurrent, resolvedSessionId]);

    // Do not let a render that React later abandons become the imperative draft authority.
    // Input handlers and draft lifecycle operations update this ref synchronously; controlled
    // values are reconciled only once their render commits.
    useLayoutEffect(() => {
        latestValue.current = value;
    }, [value]);

    // Credential replacement retires the mounted repository owner synchronously. Clear only
    // the controlled projection; subsequent edits remain ephemeral until a replacement exact
    // binding is published and must never reach the retired Account replica.
    useLayoutEffect(() => {
        if (!accountLifetime) return;
        const retirement = accountLifetime.onRetire(() => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveTimeoutRef.current = null;
            }
            latestValue.current = '';
            lastSavedValue.current = '';
            lastSessionId.current = null;
            autosaveSkip.current = null;
            onChange('');
        });
        return () => retirement.dispose();
    }, [accountLifetime, onChange]);

    const saveDraftForSession = useCallback((targetSessionId: string, draft: string) => {
        if (!draftScope || !isDraftOwnerCurrent()) return;
        writeExistingSessionDraft({
            scope: draftScope,
            sessionId: targetSessionId,
            patch: { text: draft },
            materializationIntent: 'userEdit',
        });
        if (lastSessionId.current === targetSessionId) {
            lastSavedValue.current = draft;
        }
    }, [draftScope, isDraftOwnerCurrent]);

    // Save draft to storage
    const saveDraft = useCallback((draft: string) => {
        if (!resolvedSessionId) return;
        saveDraftForSession(resolvedSessionId, draft);
    }, [resolvedSessionId, saveDraftForSession]);

    const flushDraftForSession = useCallback((targetSessionId: string) => {
        if (!draftScope || !isDraftOwnerCurrent()) return;
        fireAndForget(
            flushSessionDraft({
                scope: draftScope,
                address: { kind: 'session', sessionId: targetSessionId },
            }),
            { tag: 'useDraft.flushSessionDraft' },
        );
    }, [draftScope, isDraftOwnerCurrent]);

    const flushLatestDraftIfChanged = useCallback(() => {
        if (!resolvedSessionId) return;
        const currentValue = latestValue.current;
        const hasScheduledFlush = saveTimeoutRef.current !== null;
        const hasUnpublishedValue = currentValue !== lastSavedValue.current;
        if (!hasScheduledFlush && !hasUnpublishedValue) return;

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        if (hasUnpublishedValue) saveDraft(currentValue);
        flushDraftForSession(resolvedSessionId);
    }, [flushDraftForSession, resolvedSessionId, saveDraft]);

    const scheduleDraftFlush = useCallback((previousDraft: string, draft: string) => {
        if (!resolvedSessionId) return;
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        const wasEmpty = !containsLikelyNonWhitespace(previousDraft);
        const isEmpty = !containsLikelyNonWhitespace(draft);
        const shouldDebounceForLargeDraft = isLargeTextInputValueLength(draft.length);
        if ((wasEmpty !== isEmpty && !shouldDebounceForLargeDraft) || isEmpty) {
            flushDraftForSession(resolvedSessionId);
            return;
        }
        saveTimeoutRef.current = setTimeout(() => {
            saveTimeoutRef.current = null;
            flushDraftForSession(resolvedSessionId);
        }, autoSaveInterval);
    }, [autoSaveInterval, flushDraftForSession, resolvedSessionId]);

    const setDraftValue = useCallback((nextValueOrUpdater: string | ((currentValue: string) => string)) => {
        const nextValue = typeof nextValueOrUpdater === 'function'
            ? nextValueOrUpdater(latestValue.current)
            : nextValueOrUpdater;
        const previousSavedValue = lastSavedValue.current;
        latestValue.current = nextValue;
        onChange(nextValue);
        if (nextValue === previousSavedValue) return;

        saveDraft(nextValue);
        scheduleDraftFlush(previousSavedValue, nextValue);
    }, [onChange, saveDraft, scheduleDraftFlush]);

    const clearForkInitialPrompt = useCallback((tag: string) => {
        if (!resolvedSessionId || !forkInitialPromptText || !draftScope || !isDraftOwnerCurrent()) return;
        fireAndForget(
            sync.patchSessionMetadataWithRetry(resolvedSessionId, (metadata) =>
                clearForkInitialPromptV1({ metadata }),
                {
                    serverId: draftScope.serverId,
                    ...(accountLifetime ? { accountLifetime } : {}),
                },
            ),
            { tag },
        );
    }, [accountLifetime, draftScope, forkInitialPromptText, isDraftOwnerCurrent, resolvedSessionId]);

    const clearSessionInitialPrompt = useCallback((tag: string) => {
        if (!resolvedSessionId || !sessionInitialPromptKey || !draftScope || !isDraftOwnerCurrent()) return;
        consumedSessionInitialPromptKeyRef.current = sessionInitialPromptKey;
        fireAndForget(
            sync.patchSessionMetadataWithRetry(resolvedSessionId, (metadata) =>
                clearSessionInitialPromptV1({ metadata }),
                {
                    serverId: draftScope.serverId,
                    ...(accountLifetime ? { accountLifetime } : {}),
                },
            ),
            { tag },
        );
    }, [accountLifetime, draftScope, isDraftOwnerCurrent, resolvedSessionId, sessionInitialPromptKey]);

    const composeSessionInitialPromptText = useCallback((baseText: string, prompt: SessionInitialPromptV1): string => {
        if (prompt.mode === 'replace') return prompt.text;
        const trimmedBase = baseText.trimEnd();
        if (!trimmedBase) return prompt.text;
        return `${trimmedBase}\n\n${prompt.text}`;
    }, []);

    const adoptPersistedDraftText = useCallback((draft: string) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }
        if (latestValue.current !== draft) {
            latestValue.current = draft;
            onChange(draft);
        }
        lastSavedValue.current = draft;
        if (resolvedSessionId) autosaveSkip.current = { sessionId: resolvedSessionId, value: draft };
    }, [onChange, resolvedSessionId]);

    const persistSeededDraftText = useCallback((draft: string, prompt?: SessionInitialPromptV1 | null) => {
        if (latestValue.current !== draft) {
            latestValue.current = draft;
            onChange(draft);
        }
        if (draftScope && resolvedSessionId && isDraftOwnerCurrent()) {
            writeExistingSessionDraft({
                scope: draftScope,
                sessionId: resolvedSessionId,
                patch: {
                    text: draft,
                    ...(prompt?.source ? { sessionDiscussionSelectionSourceV1: prompt.source } : {}),
                },
                materializationIntent: 'seeded',
            });
        } else {
            saveDraft(draft);
        }
        lastSavedValue.current = draft;
    }, [draftScope, isDraftOwnerCurrent, onChange, resolvedSessionId, saveDraft]);

    // Load draft on mount and when focused. When switching sessions, always sync the composer
    // to the target session (draft or empty) to avoid leaking the previous session's text.
    useEffect(() => {
        if (!resolvedSessionId) return;

        const currentStoredDraft = draftScope && isDraftOwnerCurrent()
            ? getSessionDraftSnapshot(draftScope, { kind: 'session', sessionId: resolvedSessionId })
                ?.document.composer.text.value ?? null
            : null;

        const previousSessionId = lastSessionId.current;
        lastSessionId.current = resolvedSessionId;
        const didSessionChange = previousSessionId !== null && previousSessionId !== resolvedSessionId;

        const currentValue = latestValue.current;

        if (didSessionChange) {
            if (previousSessionId && currentValue !== lastSavedValue.current) {
                saveDraftForSession(previousSessionId, currentValue);
            }
            if (previousSessionId) {
                flushDraftForSession(previousSessionId);
            }
            autosaveSkip.current = { sessionId: resolvedSessionId, value: currentValue };
            const baseStoredDraft = currentStoredDraft && currentStoredDraft.trim() ? currentStoredDraft : null;
            const baseText = baseStoredDraft ?? forkInitialPromptText ?? null;
            const nextDraft = baseText !== null && activeSessionInitialPrompt
                ? composeSessionInitialPromptText(baseText, activeSessionInitialPrompt)
                : baseText ?? (activeSessionInitialPrompt ? composeSessionInitialPromptText('', activeSessionInitialPrompt) : null);

            if (nextDraft !== null) {
                if (activeSessionInitialPrompt || baseStoredDraft === null) {
                    persistSeededDraftText(nextDraft, activeSessionInitialPrompt);
                } else {
                    adoptPersistedDraftText(nextDraft);
                }
                if (baseStoredDraft !== null) {
                    clearForkInitialPrompt('useDraft.consumeForkInitialPrompt.sessionChange.storedDraft');
            } else if (forkInitialPromptText) {
                    clearForkInitialPrompt('useDraft.consumeForkInitialPrompt.sessionChange');
                }
                clearSessionInitialPrompt('useDraft.consumeSessionInitialPrompt.sessionChange');
            } else if (currentValue.trim()) {
                latestValue.current = '';
                onChange('');
                lastSavedValue.current = '';
            } else {
                lastSavedValue.current = '';
            }
            return;
        }

        if (!active) return;

        const externalDraft = currentStoredDraft && currentStoredDraft.trim() ? currentStoredDraft : null;
        if (externalDraft != null && externalDraft === currentValue && lastSavedValue.current !== externalDraft && !activeSessionInitialPrompt) {
            lastSavedValue.current = externalDraft;
            clearForkInitialPrompt('useDraft.consumeForkInitialPrompt.focus.syncedDraft');
        }
        const canAdoptExternalDraft =
            externalDraft != null
                ? currentValue === lastSavedValue.current || (!currentValue.trim() && !lastSavedValue.current.trim())
                : false;
        const canAdoptWithoutExternalDraft = currentValue === lastSavedValue.current || !currentValue.trim();

        if (externalDraft != null && canAdoptExternalDraft) {
            const nextDraft = activeSessionInitialPrompt
                ? composeSessionInitialPromptText(externalDraft, activeSessionInitialPrompt)
                : externalDraft;
            if (activeSessionInitialPrompt) {
                persistSeededDraftText(nextDraft, activeSessionInitialPrompt);
            } else {
                adoptPersistedDraftText(nextDraft);
            }
            clearForkInitialPrompt('useDraft.consumeForkInitialPrompt.focus.storedDraft');
            clearSessionInitialPrompt('useDraft.consumeSessionInitialPrompt.focus.storedDraft');
        } else if (forkInitialPromptText && !currentValue.trim()) {
            const nextDraft = activeSessionInitialPrompt
                ? composeSessionInitialPromptText(forkInitialPromptText, activeSessionInitialPrompt)
                : forkInitialPromptText;
            persistSeededDraftText(nextDraft, activeSessionInitialPrompt);
            clearForkInitialPrompt('useDraft.consumeForkInitialPrompt.focus');
            clearSessionInitialPrompt('useDraft.consumeSessionInitialPrompt.focus.forkPrompt');
        } else if (activeSessionInitialPrompt && canAdoptWithoutExternalDraft) {
            const nextDraft = composeSessionInitialPromptText(currentValue, activeSessionInitialPrompt);
            persistSeededDraftText(nextDraft, activeSessionInitialPrompt);
            clearSessionInitialPrompt('useDraft.consumeSessionInitialPrompt.focus');
        } else if (!currentStoredDraft) {
            // Ensure lastSavedValue is empty if there's no draft
            lastSavedValue.current = '';
        }
    }, [active, activeSessionInitialPrompt, adoptPersistedDraftText, clearForkInitialPrompt, clearSessionInitialPrompt, composeSessionInitialPromptText, draftScope, flushDraftForSession, forkInitialPromptText, isDraftOwnerCurrent, onChange, persistSeededDraftText, resolvedSessionId, saveDraftForSession, storedDraft]);

    useEffect(() => {
        if (!draftScope || !resolvedSessionId || !isDraftOwnerCurrent()) return;
        let previousSnapshot = getSessionDraftSnapshot(
            draftScope,
            { kind: 'session', sessionId: resolvedSessionId },
        );
        return subscribeSessionDraft(draftScope, { kind: 'session', sessionId: resolvedSessionId }, () => {
            if (!isDraftOwnerCurrent()) return;
            const nextSnapshot = getSessionDraftSnapshot(
                draftScope,
                { kind: 'session', sessionId: resolvedSessionId },
            );
            const repositoryDraftWasRemoved = previousSnapshot !== null && nextSnapshot === null;
            previousSnapshot = nextSnapshot;
            if (nextSnapshot === null && !repositoryDraftWasRemoved) return;

            const next = nextSnapshot?.document.composer.text.value ?? '';
            if (next === latestValue.current) {
                lastSavedValue.current = next;
                return;
            }
            // Pending/conflicted edits stay materialized in the repository. This guard only
            // protects a caller-owned edit that has not yet reached that canonical replica.
            if (repositoryDraftWasRemoved && latestValue.current !== lastSavedValue.current) return;
            adoptPersistedDraftText(next);
        });
    }, [adoptPersistedDraftText, draftScope, isDraftOwnerCurrent, resolvedSessionId]);

    // Auto-save with smart debouncing
    useEffect(() => {
        if (!resolvedSessionId) return;

        // A later input/lifecycle operation can supersede this committed render before passive
        // effects run. Its closed-over value is then historical and must not be persisted back
        // over the canonical replica after an outbound handoff clear.
        if (value !== latestValue.current) return;

        // Only save if value has changed
        const skip = autosaveSkip.current;
        if (skip && skip.sessionId === resolvedSessionId && skip.value === value) {
            autosaveSkip.current = null;
            return;
        }

        if (value !== lastSavedValue.current) {
            const previousSavedValue = lastSavedValue.current;
            saveDraft(value);
            scheduleDraftFlush(previousSavedValue, value);
        }
    }, [resolvedSessionId, saveDraft, scheduleDraftFlush, value]);

    useEffect(() => () => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }
    }, [draftScope, resolvedSessionId]);

    // Save on app state change (background/inactive)
    useEffect(() => {
        if (!resolvedSessionId) return;

        const handleAppStateChange = (nextAppState: AppStateStatus) => {
            if (nextAppState === 'background' || nextAppState === 'inactive') {
                flushLatestDraftIfChanged();
            }
        };

        const subscription = AppState.addEventListener('change', handleAppStateChange);

        return () => {
            subscription.remove();
        };
    }, [flushLatestDraftIfChanged, resolvedSessionId]);

    useWebLifecycleFlush(Boolean(resolvedSessionId), flushLatestDraftIfChanged);

    // Save on unmount only; session changes are handled explicitly above so they do not race with clearDraft().
    useEffect(() => {
        return () => {
            const currentSessionId = lastSessionId.current;
            const currentValue = latestValue.current;
            if (currentSessionId && currentValue !== lastSavedValue.current) {
                saveDraftForSession(currentSessionId, currentValue);
            }
            if (currentSessionId) flushDraftForSession(currentSessionId);
        };
    }, [flushDraftForSession, saveDraftForSession]);

    // Clear draft (used after message is sent)
    const clearDraft = useCallback(() => {
        if (!resolvedSessionId) return;

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        saveDraftForSession(resolvedSessionId, '');
        flushDraftForSession(resolvedSessionId);
        latestValue.current = '';
        lastSavedValue.current = '';
    }, [flushDraftForSession, resolvedSessionId, saveDraftForSession]);

    const clearDraftForSessionIfCurrentValueMatches = useCallback((snapshot: SessionDraftTextSnapshot) => {
        const targetSessionId = normalizeSessionId(snapshot.sessionId);
        if (!targetSessionId) return false;

        if (lastSessionId.current !== targetSessionId) {
            const targetDraft = draftScope && isDraftOwnerCurrent()
                ? getSessionDraftSnapshot(draftScope, { kind: 'session', sessionId: targetSessionId })
                    ?.document.composer.text.value
                : undefined;
            if (targetDraft !== snapshot.text) return false;
            saveDraftForSession(targetSessionId, '');
            flushDraftForSession(targetSessionId);
            return true;
        }

        if (latestValue.current !== snapshot.text) {
            if (latestValue.current !== lastSavedValue.current) {
                saveDraftForSession(targetSessionId, latestValue.current);
            }
            return false;
        }

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        saveDraftForSession(targetSessionId, '');
        flushDraftForSession(targetSessionId);
        onChange('');
        latestValue.current = '';
        lastSavedValue.current = '';
        autosaveSkip.current = { sessionId: targetSessionId, value: '' };
        return true;
    }, [draftScope, flushDraftForSession, isDraftOwnerCurrent, onChange, saveDraftForSession]);

    const clearDraftIfCurrentValueMatches = useCallback((expectedValue: string) => {
        if (!resolvedSessionId) return false;
        return clearDraftForSessionIfCurrentValueMatches({
            sessionId: resolvedSessionId,
            text: expectedValue,
        });
    }, [clearDraftForSessionIfCurrentValueMatches, resolvedSessionId]);

    // The current-value owner is also the handoff-clear owner. Callers that
    // need to compare an accepted snapshot must observe this value rather than
    // a rendered or persisted projection that can lag a local edit.
    const readLatestDraftValue = useCallback(() => latestValue.current, []);

    const restoreDraft = useCallback((draft: string) => {
        if (!resolvedSessionId) return;

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        onChange(draft);
        saveDraftForSession(resolvedSessionId, draft);
        latestValue.current = draft;
        lastSavedValue.current = draft;
        autosaveSkip.current = { sessionId: resolvedSessionId, value: draft };
    }, [onChange, resolvedSessionId, saveDraftForSession]);

    const restoreComposerSnapshot = useCallback((snapshot: SessionDraftTextSnapshot) => {
        const targetSessionId = normalizeSessionId(snapshot.sessionId);
        if (!targetSessionId) return;

        if (lastSessionId.current !== targetSessionId) {
            saveDraftForSession(targetSessionId, snapshot.text);
            return;
        }

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        onChange(snapshot.text);
        saveDraftForSession(targetSessionId, snapshot.text);
        latestValue.current = snapshot.text;
        lastSavedValue.current = snapshot.text;
        autosaveSkip.current = { sessionId: targetSessionId, value: snapshot.text };
    }, [onChange, saveDraftForSession]);

    const restoreDraftForSessionIfCurrentValueMatches = useCallback((
        snapshot: SessionDraftTextSnapshot,
        expectedCurrentValue: string,
    ) => {
        const targetSessionId = normalizeSessionId(snapshot.sessionId);
        if (!targetSessionId) return false;

        if (lastSessionId.current !== targetSessionId) {
            const targetDraft = draftScope && isDraftOwnerCurrent()
                ? getSessionDraftSnapshot(draftScope, { kind: 'session', sessionId: targetSessionId })
                    ?.document.composer.text.value
                : undefined;
            const currentDraft = typeof targetDraft === 'string' ? targetDraft : '';
            if (currentDraft !== expectedCurrentValue) return false;
            saveDraftForSession(targetSessionId, snapshot.text);
            return true;
        }

        if (latestValue.current !== expectedCurrentValue) {
            if (latestValue.current !== lastSavedValue.current) {
                saveDraftForSession(targetSessionId, latestValue.current);
            }
            return false;
        }

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        onChange(snapshot.text);
        saveDraftForSession(targetSessionId, snapshot.text);
        latestValue.current = snapshot.text;
        lastSavedValue.current = snapshot.text;
        autosaveSkip.current = { sessionId: targetSessionId, value: snapshot.text };
        return true;
    }, [draftScope, isDraftOwnerCurrent, onChange, saveDraftForSession]);

    return {
        clearDraft,
        clearDraftIfCurrentValueMatches,
        clearDraftForSessionIfCurrentValueMatches,
        readLatestDraftValue,
        setDraftValue,
        restoreDraft,
        restoreComposerSnapshot,
        restoreDraftForSessionIfCurrentValueMatches,
    };
}
