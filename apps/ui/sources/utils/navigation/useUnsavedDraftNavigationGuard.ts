import * as React from 'react';

import { Modal } from '@/modal';
import { t } from '@/text';
import {
    runUnsavedChangesGuard,
    type ActiveUnsavedChangesGuard,
} from '@/utils/navigation/runGuardedNavigation';
import { useActiveUnsavedChangesGuard } from '@/utils/navigation/useActiveUnsavedChangesGuard';
import { useUnsavedChangesBeforeRemoveGuard } from '@/utils/navigation/useUnsavedChangesBeforeRemoveGuard';
import { promptUnsavedChangesAlert } from '@/utils/ui/promptUnsavedChangesAlert';

type NavigationDispatcher = Readonly<{ dispatch?: (action: unknown) => void }>;

/**
 * One unsaved-draft departure contract for an authoring page.
 *
 * Cancel, native/hardware Back, the shell's own navigation and a browser unload
 * are the same decision about the same dirty draft, and each authoring host was
 * re-deriving it: the canonical copy keys, the discard/save wiring, the
 * intercepted-action continuation and the Cancel runner. This binds a host's
 * dirty state to the existing guard owners once so the decision has a single
 * shape, and returns the Cancel entry point for that page.
 *
 * It owns no draft: `isDirty`, `onDiscard` and `onSave` stay with the host that
 * knows what changed and how to commit it. `continueOnSave` is deliberately
 * fixed to `false` because a save owner decides where the person goes next, and
 * a refused save must never navigate away from work it did not persist.
 */
export function useUnsavedDraftNavigationGuard(params: Readonly<{
    navigation: unknown;
    isDirty: boolean;
    /** Clears the host's own dirty bookkeeping once the person discards. */
    onDiscard?: () => void;
    /** Commits through the host's canonical save owner; `false` keeps the page. */
    onSave?: () => boolean | Promise<boolean>;
    /** Where an allowed departure goes when no intercepted action was supplied. */
    onLeave?: () => void;
    tag: string;
}>): Readonly<{ requestLeave: () => void; allowSavedNavigation: () => void }> {
    const { isDirty, navigation, onDiscard, onLeave, onSave, tag } = params;
    const isDirtyRef = React.useRef(isDirty);
    isDirtyRef.current = isDirty;
    const ignoreRef = React.useRef(false);

    const requestDecision = React.useCallback(() => promptUnsavedChangesAlert(
        (title, message, buttons) => Modal.alert(title, message, buttons),
        {
            title: t('common.discardChanges'),
            message: t('common.unsavedChangesWarning'),
            discardText: t('common.discard'),
            ...(onSave ? { saveText: t('common.save') } : {}),
            keepEditingText: t('common.keepEditing'),
        },
    ), [onSave]);
    const discard = React.useCallback(() => {
        isDirtyRef.current = false;
        onDiscard?.();
    }, [onDiscard]);
    const continueNavigation = React.useCallback((action: unknown) => {
        const dispatch = (navigation as NavigationDispatcher | null)?.dispatch;
        if (action && typeof dispatch === 'function') {
            dispatch(action);
            return;
        }
        onLeave?.();
    }, [navigation, onLeave]);

    const guard = React.useMemo<ActiveUnsavedChangesGuard>(() => ({
        isDirtyRef,
        ignoreRef,
        requestDecision,
        onDiscard: discard,
        onSave,
        continueOnSave: false,
        tag,
    }), [discard, onSave, requestDecision, tag]);

    useUnsavedChangesBeforeRemoveGuard({
        isDirty,
        isDirtyRef,
        ignoreRef,
        requestDecision,
        onDiscard: discard,
        onSave,
        continueOnSave: false,
        onContinue: continueNavigation,
        tag,
    });
    useActiveUnsavedChangesGuard({ navigation, guard, enabled: isDirty });

    const requestLeave = React.useCallback(() => {
        void runUnsavedChangesGuard(guard, () => onLeave?.());
    }, [guard, onLeave]);

    const allowSavedNavigation = React.useCallback(() => {
        ignoreRef.current = true;
        isDirtyRef.current = false;
    }, []);

    return React.useMemo(() => ({ requestLeave, allowSavedNavigation }), [requestLeave, allowSavedNavigation]);
}
