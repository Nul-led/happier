import * as React from 'react';
import { View } from 'react-native';
import { useNavigation, useRouter } from '@/components/appShell/workspace/destinationRoute';
import { StyleSheet } from 'react-native-unistyles';

import type { CodeEditorHandle } from '@/components/ui/code/editor/codeEditorTypes';
import { MarkdownCodeEditorField } from '@/components/ui/markdown/editor/MarkdownCodeEditorField';
import { useSetting } from '@/sync/domains/state/storage';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SectionContentRow } from '@/components/ui/lists/SectionContentRow';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { Modal } from '@/modal';
import { updateSkillPromptBundleWithEntry, readPromptBundleUtf8Entry } from '@/sync/ops/promptLibrary/promptBundles';
import { t } from '@/text';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';

import { readSkillBundleArtifactState } from './readSkillBundleArtifactState';

const styles = StyleSheet.create((theme) => ({
    editorContainer: {
        borderRadius: 10,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        minHeight: 320,
    },
}));

/** One file of a skill bundle beside its SKILL.md: its path and its text. Saving returns to the skill. */
export const SkillBundleSupportingFileEditorScreen = React.memo(function SkillBundleSupportingFileEditorScreen(props: Readonly<{
    artifactId: string;
    path: string | null;
}>) {
    const router = useRouter();
    const navigation = useNavigation();
    const artifactState = React.useMemo(() => readSkillBundleArtifactState(props.artifactId), [props.artifactId]);
    const [path, setPath] = React.useState(props.path ?? '');
    const [content, setContent] = React.useState('');
    const [saving, setSaving] = React.useState(false);
    const wrapLinesInDiffs = useSetting('wrapLinesInDiffs');
    // Flushed before reading `content` on save so the latest rich/raw edit (which
    // may still be debounced inside the active editor surface) is captured.
    const editorRef = React.useRef<CodeEditorHandle | null>(null);

    React.useEffect(() => {
        setPath(props.path ?? '');
        if (!artifactState || !props.path) {
            setContent('');
            return;
        }
        setContent(readPromptBundleUtf8Entry(artifactState.body, props.path) ?? '');
    }, [artifactState, props.path]);

    const canSave = Boolean(artifactState) && path.trim().length > 0 && !saving;

    const save = React.useCallback(async () => {
        if (!artifactState || !canSave) return;
        try {
            setSaving(true);
            // Flush any debounced edit out of the active editor surface, then read
            // the freshest content from its handle (state may not have caught up).
            await editorRef.current?.flushPendingChange();
            const latestContent = editorRef.current?.getValue() ?? content;
            await updateSkillPromptBundleWithEntry({
                artifactId: props.artifactId,
                path: path.trim(),
                content: latestContent,
            });
            safeRouterBack({ router, navigation, fallbackHref: `/settings/prompts/skills/${props.artifactId}` });
        } catch {
            Modal.alert(t('common.error'), t('promptLibrary.saveError'));
        } finally {
            setSaving(false);
        }
    }, [artifactState, canSave, content, navigation, path, props.artifactId, router]);

    return (
        <ItemList presentation="page" keyboardShouldPersistTaps="handled">
            <PageHeader
                testID="skillSupportingFile.header"
                alwaysShowTitle
                title={props.path ?? t('promptLibrary.newSupportingFile')}
                description={artifactState?.title
                    ? t('promptLibrary.surface.supportingFileDescription', { skill: artifactState.title })
                    : undefined}
                actions={(
                    <RoundButton
                        testID="skillSupportingFile.save"
                        size="small"
                        title={t('common.save')}
                        disabled={!canSave}
                        loading={saving}
                        onPress={() => { void save(); }}
                    />
                )}
            />

            <ItemGroup title={t('promptLibrary.surface.fileSection')}>
                <Item
                    title={t('promptLibrary.supportingFilePathLabel')}
                    subtitle={t('promptLibrary.surface.filePathDescription')}
                    accessoryLayout="adaptive"
                    showChevron={false}
                    rightElement={(
                        <FieldTextInput
                            testID="skillSupportingFile.path"
                            value={path}
                            onChangeText={setPath}
                            accessibilityLabel={t('promptLibrary.supportingFilePathLabel')}
                            placeholder={t('promptLibrary.supportingFilePathPlaceholder')}
                            autoCapitalize="none"
                            autoFocus={!props.path}
                            monospace
                        />
                    )}
                />
            </ItemGroup>

            <ItemGroup title={t('promptLibrary.supportingFileContent')}>
                <SectionContentRow>
                    <View style={styles.editorContainer}>
                        <MarkdownCodeEditorField
                            resetKey={`${props.artifactId}:${props.path ?? 'new'}`}
                            testID="skillSupportingFile.editor"
                            value={content}
                            filePath={path}
                            onChange={setContent}
                            readOnly={false}
                            editorRef={editorRef}
                            wrapLines={wrapLinesInDiffs !== false}
                        />
                    </View>
                </SectionContentRow>
            </ItemGroup>
        </ItemList>
    );
});
