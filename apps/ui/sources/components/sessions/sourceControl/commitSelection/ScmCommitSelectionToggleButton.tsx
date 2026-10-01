import * as React from 'react';
import { Platform, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';
import type { ScmFileStatus } from '@/scm/scmStatusFiles';
import type { ScmCommitStrategy } from '@/scm/settings/commitStrategy';
import { applyFileStageAction } from '@/scm/operations/applyFileStageAction';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { t } from '@/text';
import { toTestIdSafeValue } from '@/utils/ui/toTestIdSafeValue';
import { ActivitySpinner, iconMatchedSpinnerSize } from '@/components/ui/feedback/ActivitySpinner';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { Icon } from '@/components/ui/icons/Icon';
import { SelectionCheckGlyph, type SelectionCheckState } from '@/components/ui/selection/SelectionCheckGlyph';
import { isAtomicCommitStrategy } from '@/scm/settings/commitStrategy';
import { useChangedFileRowLayout } from '@/components/workspaces/scm/changes/useChangedFileRowLayout';

export type ScmCommitSelectionToggleButtonProps = Readonly<{
    sessionId: string;
    serverId?: string;
    sessionPath: string | null;
    snapshot: ScmWorkingSnapshot | null;
    scmWriteEnabled: boolean;
    commitStrategy: ScmCommitStrategy;
    file: ScmFileStatus;
    selectedForCommit: boolean;
    surface: 'file' | 'files';
    onAfterToggle?: () => void | Promise<void>;
    /**
     * `toggle` (default): the "+" / "✓" include control of a file header. `checkbox`: the Git list's
     * leading checkbox column (session-tabs G1), drawn by {@link ScmCommitSelectionCheckGlyph}.
     */
    appearance?: 'toggle' | 'checkbox';
}>;

const COMMIT_TOGGLE_ICON_SIZE_PX = 14;

/**
 * The commit selection's checkbox mark: one file (checked or not) or a whole group (`mixed` when some
 * of it is selected). The Git list's rows and group headers draw the same mark, at the list's density:
 * 16 px beside a two-line row, 14 px on the compact one-line rhythm (Git lab TV).
 */
export function ScmCommitSelectionCheckGlyph(props: Readonly<{ state: SelectionCheckState }>): React.ReactElement {
    const layout = useChangedFileRowLayout();
    return <SelectionCheckGlyph state={props.state} size={layout === 'compact' ? 'compact' : 'regular'} />;
}

export const ScmCommitSelectionToggleButton = React.memo((props: ScmCommitSelectionToggleButtonProps) => {
    const { theme } = useUnistyles();
    const [busy, setBusy] = React.useState(false);
    const compactRow = useChangedFileRowLayout() === 'compact' && props.appearance === 'checkbox';

    const iconName = props.selectedForCommit ? 'check' : 'plus';
    const iconColor = props.selectedForCommit ? theme.colors.state.success.foreground : theme.colors.text.secondary;
    const accessibilityLabel = isAtomicCommitStrategy(props.commitStrategy)
        ? props.selectedForCommit
            ? t('files.commitSelection.removeFromCommit')
            : t('files.commitSelection.addToCommit')
        : props.selectedForCommit
            ? t('files.fileActions.unstageFile')
            : t('files.fileActions.stageFile');

    return (
        <View style={Platform.OS === 'web' ? { marginVertical: -3 } : undefined}>
            <IconButton
                variant="plain"
                size={compactRow ? 24 : 28}
                testID={`scm-commit-selection-toggle-${toTestIdSafeValue(props.file.fullPath)}`}
                accessibilityLabel={accessibilityLabel}
                disabled={busy || !props.scmWriteEnabled}
                {...(props.appearance === 'checkbox'
                    ? { accessibilityRole: 'checkbox' as const, checked: props.selectedForCommit, selectedBackground: false }
                    : {})}
                icon={busy
                    ? <ActivitySpinner size={iconMatchedSpinnerSize(COMMIT_TOGGLE_ICON_SIZE_PX)} color={theme.colors.text.secondary} />
                    : props.appearance === 'checkbox'
                        ? <ScmCommitSelectionCheckGlyph state={props.selectedForCommit ? 'checked' : 'unchecked'} />
                        : <Icon name={iconName as any} size={COMMIT_TOGGLE_ICON_SIZE_PX} color={iconColor} />}
                onPress={(e: any) => {
                    e?.stopPropagation?.();
                    fireAndForget((async () => {
                        setBusy(true);
                        try {
                            await applyFileStageAction({
                                sessionId: props.sessionId,
                                serverId: props.serverId,
                                sessionPath: props.sessionPath,
                                filePath: props.file.fullPath,
                                snapshot: props.snapshot,
                                scmWriteEnabled: props.scmWriteEnabled,
                                commitStrategy: props.commitStrategy,
                                stage: !props.selectedForCommit,
                                surface: props.surface,
                            });
                            await props.onAfterToggle?.();
                        } finally {
                            setBusy(false);
                        }
                    })(), { tag: 'ScmCommitSelectionToggleButton.onPress' });
                }}
            />
        </View>
    );
});
