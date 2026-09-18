import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { Typography } from '@/constants/Typography';
import type { CustomModalInjectedProps } from '@/modal';
import { t } from '@/text';
import type { WorkflowValidationIssue } from '@happier-dev/protocol/workflows/workflowV1';

import type { WorkflowEditorDraft } from '@/sync/domains/workflows/workflowEditorDraft';

const styles = StyleSheet.create((theme) => ({
    root: {
        gap: theme.margins.md,
    },
    explanation: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
    issueList: {
        gap: theme.margins.sm,
    },
    issue: {
        gap: theme.margins.xs,
        paddingVertical: theme.margins.sm,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border.default,
    },
    issueMessage: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    issuePath: {
        ...Typography.mono(),
        color: theme.colors.text.secondary,
    },
    actions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        flexWrap: 'wrap',
        gap: theme.margins.md,
    },
    action: {
        minHeight: resolveMinimumInteractiveTargetSize(Platform.OS),
        justifyContent: 'center',
        paddingHorizontal: theme.margins.sm,
    },
    secondaryActionText: {
        ...Typography.default('semiBold'),
        color: theme.colors.button.secondary.tint,
    },
    primaryActionText: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.link,
    },
}));

export function WorkflowImportReview(props: Readonly<{
    issues: readonly WorkflowValidationIssue[];
    repairDraft?: WorkflowEditorDraft;
    onOpenRepair: (draft: WorkflowEditorDraft) => void;
}> & CustomModalInjectedProps): React.ReactElement {
    const repairDraft = props.repairDraft;
    return (
        <View testID="workflow-import-review" style={styles.root} accessibilityRole="alert">
            <Text style={styles.explanation}>{t('workflows.interchange.importIssuesBody')}</Text>
            <View style={styles.issueList} accessibilityRole="list">
                {props.issues.map((issue, index) => (
                    <View
                        key={`${issue.path}:${issue.code}:${index}`}
                        style={styles.issue}
                        role="listitem"
                        testID={`workflow-import-issue-${index}`}
                    >
                        <Text style={styles.issueMessage}>{t(`workflows.issue.${issue.code}`)}</Text>
                        <Text selectable style={styles.issuePath}>{issue.path || '/'}</Text>
                    </View>
                ))}
            </View>
            <View style={styles.actions}>
                <Pressable
                    testID="workflow-import-dismiss"
                    accessibilityRole="button"
                    style={styles.action}
                    onPress={props.onClose}
                >
                    <Text style={styles.secondaryActionText}>{t('common.close')}</Text>
                </Pressable>
                {repairDraft === undefined ? null : (
                    <Pressable
                        testID="workflow-import-open-repair"
                        accessibilityRole="button"
                        style={styles.action}
                        onPress={() => {
                            props.onOpenRepair(repairDraft);
                            props.onClose();
                        }}
                    >
                        <Text style={styles.primaryActionText}>{t('workflows.interchange.openRepairDraft')}</Text>
                    </Pressable>
                )}
            </View>
        </View>
    );
}
