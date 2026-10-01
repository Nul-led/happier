import {
    resolveSessionReminderPresetRule,
    sessionReminderPresetRuleKey,
    type SessionReminderPresetIntent,
    type SessionReminderPresetV1,
} from '@/sync/domains/session/organization/sessionReminderPreset';
import { Modal } from '@/modal';
import { t } from '@/text';

import { resolveSessionAttentionReminderSelection, SESSION_ATTENTION_REMINDER_MENU_ID } from './sessionAttentionReminderAction';
import { showSessionReminderDateTimeModal, showSessionReminderPresetManagerModal } from './sessionReminderModals';

export type SessionReminderWriteResult = Readonly<{ success: boolean; message?: string }>;

export function isSessionReminderMenuItemId(itemId: string): boolean {
    return itemId.startsWith(`${SESSION_ATTENTION_REMINDER_MENU_ID}:`);
}

/**
 * The one handler for the "Remind me" submenu (built by `buildSessionReminderMenuItem`), shared by
 * the session row menu and the Inbox row menu. The caller supplies the writer; the presets, the
 * custom date modal and the preset manager stay here so both menus behave identically.
 */
export async function handleSessionReminderMenuSelection(params: Readonly<{
    itemId: string;
    canSchedule: boolean;
    canClear: boolean;
    presets: readonly SessionReminderPresetV1[];
    applyPresetIntent: (intent: SessionReminderPresetIntent) => Promise<void>;
    schedule: (remindAt: number) => Promise<SessionReminderWriteResult>;
    clear: () => Promise<SessionReminderWriteResult>;
}>): Promise<void> {
    const nowMs = Date.now();
    const selection = resolveSessionAttentionReminderSelection(params.itemId, nowMs);
    if (selection?.kind === 'current') return;
    if (selection?.kind === 'remove') {
        if (!params.canClear) return;
        const result = await params.clear();
        if (!result.success) Modal.alert(t('common.error'), result.message ?? t('errors.unknownError'));
        return;
    }
    if (!params.canSchedule) return;
    if (selection?.kind === 'custom') {
        // The modal owns the draft until the one canonical save succeeds, so a failed save
        // keeps the chosen instant and the Add-to-presets switch for a retry.
        await showSessionReminderDateTimeModal(
            nowMs,
            async (value) => await params.schedule(value.remindAt),
            async (preset) => await params.applyPresetIntent({ kind: 'upsert', preset }),
        );
        return;
    }
    if (selection?.kind === 'manage_presets') {
        await showSessionReminderPresetManagerModal(params.presets, async (presets) => {
            await params.applyPresetIntent({ kind: 'replace', presets, expectedPresets: params.presets });
        });
        return;
    }
    let remindAt = selection?.kind === 'timestamp' ? selection.remindAt : null;
    if (selection?.kind === 'preset') {
        const preset = params.presets.find((candidate) => sessionReminderPresetRuleKey(candidate.rule) === selection.ruleKey);
        remindAt = preset ? resolveSessionReminderPresetRule(preset.rule, nowMs) : null;
    }
    if (remindAt !== null) {
        const result = await params.schedule(remindAt);
        if (!result.success) Modal.alert(t('common.error'), result.message ?? t('errors.unknownError'));
    }
}
