import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { WorkflowArtifactRevisionV1 } from '@happier-dev/protocol/workflows/workflowDefinitionV1';

import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';

export type WorkflowSaveConflict = Readonly<{
    currentDraft: WorkflowEditorDraft | null;
    currentRevision: WorkflowArtifactRevisionV1 | null;
}>;

const styles = StyleSheet.create((theme) => ({
    receipt: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    conflict: {
        gap: theme.margins.sm,
        padding: theme.margins.md,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        borderRadius: theme.margins.sm,
    },
    conflictTitle: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    conflictBody: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: theme.margins.md,
    },
    action: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.link,
    },
    comparison: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: theme.margins.md,
    },
    comparisonPane: {
        flexGrow: 1,
        flexBasis: 280,
        minWidth: 0,
        gap: theme.margins.xs,
    },
    document: {
        ...Typography.default('regular'),
        color: theme.colors.text.primary,
    },
}));

export function formatWorkflowArtifactRevision(revision: WorkflowArtifactRevisionV1): string {
    return `h${revision.headerVersion} · b${revision.bodyVersion}`;
}

function readableDraft(draft: WorkflowEditorDraft): string {
    return JSON.stringify({
        name: draft.name,
        defaults: draft.defaults,
        inputs: draft.inputs,
        blocks: draft.blocks,
        finalOutput: draft.finalOutput,
    }, null, 2);
}

export function WorkflowSaveStatus(props: Readonly<{
    revision: WorkflowArtifactRevisionV1 | null;
    conflict: WorkflowSaveConflict | null;
    localDraft: WorkflowEditorDraft;
    onSaveAsCopy: () => void;
    savePending?: boolean;
    testIDPrefix: string;
}>): React.ReactElement | null {
    const [comparing, setComparing] = React.useState(false);

    if (props.conflict === null) {
        return props.revision === null ? null : (
            <Text testID={`${props.testIDPrefix}-saved-revision`} style={styles.receipt} accessibilityLiveRegion="polite">
                {t('workflows.editor.savedRevision', { revision: formatWorkflowArtifactRevision(props.revision) })}
            </Text>
        );
    }

    return (
        <View testID={`${props.testIDPrefix}-save-conflict`} style={styles.conflict} accessibilityRole="alert">
            <Text style={styles.conflictTitle}>{t('workflows.save.conflictTitle')}</Text>
            <Text style={styles.conflictBody}>{t('workflows.save.conflictBody')}</Text>
            <View style={styles.actions}>
                {props.conflict.currentDraft === null ? null : (
                    <Pressable testID={`${props.testIDPrefix}-compare`} accessibilityRole="button" onPress={() => setComparing((value) => !value)}>
                        <Text style={styles.action}>{t('workflows.save.compare')}</Text>
                    </Pressable>
                )}
                <Pressable
                    testID={`${props.testIDPrefix}-save-as-copy`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: props.savePending === true }}
                    disabled={props.savePending === true}
                    onPress={props.onSaveAsCopy}
                >
                    <Text style={styles.action}>{t('workflows.save.saveAsCopy')}</Text>
                </Pressable>
            </View>
            {!comparing || props.conflict.currentDraft === null ? null : (
                <View testID={`${props.testIDPrefix}-comparison`} style={styles.comparison}>
                    <View style={styles.comparisonPane}>
                        <Text style={styles.conflictBody}>{t('workflows.save.conflictBody')}</Text>
                        <Text selectable style={styles.document}>{readableDraft(props.localDraft)}</Text>
                    </View>
                    <View style={styles.comparisonPane}>
                        {props.conflict.currentRevision === null ? null : (
                            <Text style={styles.conflictBody}>
                                {t('workflows.editor.savedRevision', { revision: formatWorkflowArtifactRevision(props.conflict.currentRevision) })}
                            </Text>
                        )}
                        <Text selectable style={styles.document}>{readableDraft(props.conflict.currentDraft)}</Text>
                    </View>
                </View>
            )}
        </View>
    );
}
