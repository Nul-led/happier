import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { PluginSettingFieldV2 } from '@happier-dev/protocol';

import { ConnectedServiceSetupFlowActions } from '../setup/ConnectedServiceSetupFlowBody';
import { ConnectedAccountFormSection } from './ConnectedAccountFormSection';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { Item } from '@/components/ui/lists/Item';
import { t } from '@/text';
import { resolveProjectedLocalizedText } from '@/components/plugins/surfaces/resolvePluginDisplayString';

import { useConnectedAccountInvalidFieldFocus } from './useConnectedAccountInvalidFieldFocus';
import { useConnectedAccountDraftNavigationGuard } from './useConnectedAccountDraftNavigationGuard';

const stylesheet = StyleSheet.create(() => ({
    panelActions: {
        paddingTop: 12,
    },
    actions: {
        alignItems: 'flex-end',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
}));

type ManualAuthenticationField =
    & Omit<PluginSettingFieldV2, 'secret'>
    & Readonly<{ secret?: boolean }>;

function compareFields(left: ManualAuthenticationField, right: ManualAuthenticationField): number {
    const leftOrder = left.presentation?.order ?? Number.POSITIVE_INFINITY;
    const rightOrder = right.presentation?.order ?? Number.POSITIVE_INFINITY;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.id.localeCompare(right.id);
}

function isValidFieldValue(field: ManualAuthenticationField, value: string): boolean {
    const schema = field.schema;
    if (schema.type !== undefined && schema.type !== 'string') return false;
    if (schema.minLength !== undefined && value.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.enum !== undefined && !schema.enum.includes(value)) return false;
    if (schema.const !== undefined && schema.const !== value) return false;
    if (schema.pattern !== undefined) {
        try {
            if (!new RegExp(schema.pattern).test(value)) return false;
        } catch {
            return false;
        }
    }
    return true;
}

type ConnectedAccountManualFormProps = Readonly<{
    title: string;
    /** Inside the new-account draft, whose row already names the sign-in method. */
    embedded?: boolean;
    localize?: (value: Parameters<typeof resolveProjectedLocalizedText>[0]) => string;
    fields: readonly ManualAuthenticationField[];
    submitting: boolean;
    navigation?: unknown;
    /** In a setup panel: a compact footer with Cancel (local) beside Continue. */
    onCancel?: () => void;
    onSubmit(input: Readonly<{
        fields: Readonly<Record<string, string>>;
    }>): Promise<boolean | void> | boolean | void;
}>;

function ConnectedAccountManualFormBody(props: ConnectedAccountManualFormProps) {
    const styles = stylesheet;
    const initialDraft = React.useMemo(() => (
        Object.fromEntries(props.fields.map((field) => [field.id, '']))
    ), [props.fields]);
    const [draft, setDraft] = React.useState<Readonly<Record<string, string>>>(() => (
        initialDraft
    ));
    const [invalidFieldIds, setInvalidFieldIds] = React.useState<readonly string[]>([]);

    const fields = React.useMemo(
        () => [...props.fields]
            .filter((field) => field.presentation?.hidden !== true)
            .sort(compareFields),
        [props.fields],
    );
    const submit = React.useCallback(async () => {
        const values = Object.fromEntries(
            props.fields.map((field) => [field.id, draft[field.id] ?? '']),
        );
        const invalid = fields
            .filter((field) => !isValidFieldValue(field, values[field.id] ?? ''))
            .map((field) => field.id);
        if (invalid.length > 0) {
            setInvalidFieldIds(invalid);
            return false;
        }
        const accepted = await props.onSubmit({ fields: values });
        return accepted !== false;
    }, [draft, fields, props]);
    const discardDraft = React.useCallback(() => {
        setDraft(initialDraft);
        setInvalidFieldIds([]);
    }, [initialDraft]);
    const isDirty = props.fields.some((field) => (
        (draft[field.id] ?? '') !== (initialDraft[field.id] ?? '')
    ));
    useConnectedAccountDraftNavigationGuard({
        navigation: props.navigation,
        isDirty,
        onDiscard: discardDraft,
        onSave: submit,
        tag: 'ConnectedAccountManualForm',
    });
    const registerInvalidFieldTarget = useConnectedAccountInvalidFieldFocus({
        invalidFieldIds,
        announcement: t('common.error'),
    });

    return (
        <ConnectedAccountFormSection
            embedded={props.embedded}
            title={props.embedded ? undefined : props.title}
            description={invalidFieldIds.length > 0 ? t('common.error') : undefined}
        >
            {fields.map((field) => {
                const title = resolveProjectedLocalizedText(field.title, props.localize);
                const description = resolveProjectedLocalizedText(field.description, props.localize);
                const multiline = field.presentation?.control === 'textarea';
                const invalid = invalidFieldIds.includes(field.id);
                return (
                    <Item
                        key={field.id}
                        title={title}
                        subtitle={description || undefined}
                        subtitleLines={0}
                        mode="info"
                        showChevron={false}
                        accessoryLayout={multiline ? 'stacked' : 'adaptive'}
                        rightElement={(
                            <FieldTextInput
                                testID={`connected-account-manual:${field.id}`}
                                ref={registerInvalidFieldTarget(field.id)}
                                accessibilityLabel={invalid ? `${title}: ${t('common.error')}` : title}
                                error={invalid ? t('common.error') : null}
                                value={draft[field.id] ?? ''}
                                onChangeText={(value) => {
                                    setDraft((current) => ({ ...current, [field.id]: value }));
                                    setInvalidFieldIds((current) => current.filter((id) => id !== field.id));
                                }}
                                editable={!props.submitting}
                                secureTextEntry={field.secret === true}
                                multiline={multiline}
                                placeholder={resolveProjectedLocalizedText(field.presentation?.placeholder, props.localize)}
                            />
                        )}
                    />
                );
            })}
            {props.onCancel ? (
                <View style={styles.panelActions}>
                    <ConnectedServiceSetupFlowActions
                        onCancel={props.onCancel}
                        primary={{
                            testID: 'connected-account-manual:submit',
                            label: t('common.continue'),
                            disabled: props.submitting,
                            loading: props.submitting,
                            onPress: () => void submit(),
                        }}
                    />
                </View>
            ) : (
                <View style={styles.actions}>
                    <RoundButton
                        testID="connected-account-manual:submit"
                        title={t('common.continue')}
                        disabled={props.submitting}
                        loading={props.submitting}
                        onPress={submit}
                    />
                </View>
            )}
        </ConnectedAccountFormSection>
    );
}

/**
 * Manual credential fields can change while the route stays mounted (for
 * example after a daemon descriptor refresh). A semantic descriptor key gives
 * the form a fresh local lifetime, so no secret draft survives into a new mode.
 */
export const ConnectedAccountManualForm = React.memo(function ConnectedAccountManualForm(
    props: ConnectedAccountManualFormProps,
) {
    const draftKey = React.useMemo(() => JSON.stringify(props.fields), [props.fields]);
    return <ConnectedAccountManualFormBody key={draftKey} {...props} />;
});
