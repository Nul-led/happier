import type { AlertButton } from '@/modal/types';

export type UnsavedChangesDecision = 'discard' | 'save' | 'keepEditing';

export function promptUnsavedChangesAlert(
    alert: (title: string, message?: string, buttons?: AlertButton[]) => void,
    params: {
        title: string;
        message: string;
        discardText: string;
        /** Omitted by a guard with no save path, which then offers discard or keep editing only. */
        saveText?: string;
        keepEditingText: string;
    },
): Promise<UnsavedChangesDecision> {
    return new Promise((resolve) => {
        const saveText = params.saveText;
        alert(params.title, params.message, [
            {
                text: params.discardText,
                style: 'destructive',
                onPress: () => resolve('discard'),
            },
            ...(saveText === undefined
                ? []
                : [{
                    text: saveText,
                    style: 'default' as const,
                    onPress: () => resolve('save'),
                }]),
            {
                text: params.keepEditingText,
                style: 'cancel',
                onPress: () => resolve('keepEditing'),
            },
        ]);
    });
}

