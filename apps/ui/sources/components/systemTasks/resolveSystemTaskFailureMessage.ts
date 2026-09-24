import { t, type TranslationKey } from '@/text';
import { resolveCliAcquisitionFailureMessage } from './cliAcquisitionPresentation';

/**
 * Failure codes whose daemon sentence the app replaces with its own copy.
 * These are setup decisions the user declined in an app prompt, so the
 * remedy must name the app's controls, in the user's language.
 */
const SYSTEM_TASK_FAILURE_TRANSLATION_KEYS: Readonly<Record<string, TranslationKey>> = {
    service_reconciliation_declined: 'machine.backgroundServicePrompt.replaceDeclined',
    release_channel_switch_declined: 'machine.backgroundServicePrompt.channelSwitchDeclined',
};

/** The message to show for a failed system task: app copy for known codes, else the task's own message. */
export function resolveSystemTaskFailureMessage(
    error: Readonly<{ code?: string | null; message?: string | null }>,
): string | undefined {
    const acquisitionFailure = error.code ? resolveCliAcquisitionFailureMessage(error.code) : undefined;
    if (acquisitionFailure) return acquisitionFailure;
    const key = error.code ? SYSTEM_TASK_FAILURE_TRANSLATION_KEYS[error.code] : undefined;
    if (key) {
        return t(key);
    }
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    return message.length > 0 ? message : undefined;
}
