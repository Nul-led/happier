import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';
import { useUnistyles } from 'react-native-unistyles';

import type { DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SectionActionButton } from '@/components/ui/lists/SectionActionButton';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';

import { promptCollectionDraftHref, promptCollectionItemHref } from '../collection/promptCollectionModel';

type PromptDocOption = Readonly<{
    id: string;
    title: string;
}>;

/**
 * The prompt a template inserts: a field select of the library's prompts, a link to edit the chosen
 * one, and (as the section's action) writing a new prompt.
 */
export const PromptDocSelectionGroup = React.memo(function PromptDocSelectionGroup(props: Readonly<{
    promptDocs: readonly PromptDocOption[];
    selectedArtifactId: string;
    onSelect: (artifactId: string) => void;
    menuOpen: boolean;
    onMenuOpenChange: (open: boolean) => void;
}>) {
    const router = useRouter();
    const { theme } = useUnistyles();

    const promptTargetItems = React.useMemo((): DropdownMenuItem[] => (
        props.promptDocs.map((doc) => ({
            id: doc.id,
            title: doc.title,
            icon: <Icon name="file-text" size={20} color={theme.colors.text.secondary} />,
        }))
    ), [props.promptDocs, theme.colors.text.secondary]);

    const selectedPrompt = props.promptDocs.find((doc) => doc.id === props.selectedArtifactId) ?? null;

    return (
        <ItemGroup
            title={t('promptLibrary.templateTarget')}
            description={t('promptLibrary.surface.templateTargetDescription')}
            action={(
                <SectionActionButton
                    testID="promptTemplate.target.new"
                    title={t('promptLibrary.surface.addPrompt')}
                    icon="plus"
                    onPress={() => router.push(promptCollectionDraftHref('doc') as never)}
                />
            )}
        >
            <DropdownMenu
                open={props.menuOpen}
                onOpenChange={props.onMenuOpenChange}
                items={promptTargetItems}
                selectedId={props.selectedArtifactId}
                onSelect={(id) => props.onSelect(String(id))}
                itemTrigger={{
                    title: t('promptLibrary.templateTargetPromptLabel'),
                    subtitle: selectedPrompt?.title ?? t('promptLibrary.templateTargetPromptPlaceholder'),
                }}
                rowKind="item"
                connectToTrigger
                variant="default"
            />
            <Item
                testID="promptTemplate.target.edit"
                icon={<Icon name="pencil-simple" />}
                title={t('promptLibrary.editSelectedPrompt')}
                subtitle={selectedPrompt ? selectedPrompt.title : t('promptLibrary.editSelectedPromptDisabled')}
                disabled={!selectedPrompt}
                onPress={() => {
                    if (!selectedPrompt) return;
                    router.push(promptCollectionItemHref('doc', selectedPrompt.id) as never);
                }}
            />
        </ItemGroup>
    );
});
