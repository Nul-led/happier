import { storage } from '@/sync/domains/state/storage';
import { getSyncSingleton } from '@/sync/runtime/getSyncSingleton';
import { normalizeNonEmptyString } from '@/voice/shared/normalizeNonEmptyString';
import { voiceSettingsParse } from '@/sync/domains/settings/voiceSettings';
import type { AccountSettingsScope } from '@/sync/domains/settings/scope/accountSettingsScope';

export function readVoiceAutoTargetMachineId(state: any): string | null {
    const target = voiceSettingsParse(state?.settings?.voice).executionMachine;
    if ((normalizeNonEmptyString(target?.mode) ?? 'auto') !== 'auto') return null;
    return normalizeNonEmptyString(target?.autoMachineId);
}

export function persistVoiceAutoTargetMachineId(
    machineId: string | null,
    expectedSettingsScope: AccountSettingsScope | null,
): void {
    const normalizedMachineId = normalizeNonEmptyString(machineId);
    const state: any = storage.getState();
    if (!state?.settings?.voice) return;
    const voiceSettings = voiceSettingsParse(state.settings.voice);
    const executionMachine = voiceSettings.executionMachine;
    if ((normalizeNonEmptyString(executionMachine.mode) ?? 'auto') !== 'auto') return;
    if (normalizeNonEmptyString(executionMachine.autoMachineId) === normalizedMachineId) return;

    getSyncSingleton().applySettings({
        voice: {
            ...voiceSettings,
            executionMachine: {
                ...executionMachine,
                autoMachineId: normalizedMachineId,
            },
        },
    }, { expectedSettingsScope, source: 'ui' });
}
