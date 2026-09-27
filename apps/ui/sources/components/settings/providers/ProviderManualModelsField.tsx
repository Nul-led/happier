import * as React from 'react';

import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { TextInput } from '@/components/ui/text/Text';
import { t } from '@/text';

/** Manual model ids, one per line: the page's multiline field, with its refusal beneath it. */
export const ProviderManualModelsField = React.forwardRef<React.ElementRef<typeof TextInput>, Readonly<{
    value: string;
    onChangeText: (value: string) => void;
    editable?: boolean;
    errorText?: string | null;
}>>(function ProviderManualModelsField(props, ref) {
    return (
        <FieldTextInput
            ref={ref}
            testID="provider-manual-model-ids"
            accessibilityLabel={t('settingsProviders.models.addFieldLabel')}
            value={props.value}
            placeholder={t('settingsProviders.models.addPlaceholder')}
            multiline
            monospace
            minLines={4}
            editable={props.editable}
            error={props.errorText ?? undefined}
            onChangeText={props.onChangeText}
        />
    );
});
