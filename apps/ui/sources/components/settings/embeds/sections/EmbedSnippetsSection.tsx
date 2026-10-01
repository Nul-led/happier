import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { CodeBlockView } from '@/components/ui/code/blocks/CodeBlockView';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import { buildEmbedSnippetsV1, type EmbedSnippetsInput } from '../snippets';

type SnippetTab = 'backend' | 'react';

const stylesheet = StyleSheet.create((theme) => ({
    stack: {
        gap: 12,
    },
    steps: {
        ...Typography.rowMeta(),
        color: theme.colors.text.secondary,
    },
}));

/**
 * Snippets (plan 04 §4.10, §6.2): Backend | React, from the one builder, rendered in the canonical
 * code block with its copy behaviour. The Script tag tab appears when `@happier-dev/embed` is
 * published (release check); until then the builder produces it but it is not rendered.
 */
export const EmbedSnippetsSection = React.memo(function EmbedSnippetsSection(props: Readonly<{ input: EmbedSnippetsInput }>) {
    const [tab, setTab] = React.useState<SnippetTab>('backend');
    const snippets = React.useMemo(() => buildEmbedSnippetsV1(props.input), [props.input]);
    return (
        <ItemGroup title={t('settingsEmbeds.snippets.title')} description={t('settingsEmbeds.snippets.description')} surface="none">
            <View style={stylesheet.stack}>
                <Text style={stylesheet.steps}>{t('settingsEmbeds.snippets.steps')}</Text>
                <Text testID="settings-embed-key-reach" style={stylesheet.steps}>{t('settingsEmbeds.detail.keyReach')}</Text>
                <SegmentedTabBar<SnippetTab>
                    testIDPrefix="settings-embed-snippet-tab"
                    segmentSizing="content"
                    tabs={[
                        { id: 'backend', label: t('settingsEmbeds.snippets.backend') },
                        { id: 'react', label: t('settingsEmbeds.snippets.react') },
                    ]}
                    activeTabId={tab}
                    onSelectTab={setTab}
                />
                <CodeBlockView
                    code={tab === 'backend' ? snippets.backend : snippets.react}
                    language={tab === 'backend' ? 'typescript' : 'tsx'}
                    showCopyButton
                    scrollTestID={`settings-embed-snippet-${tab}`}
                />
            </View>
        </ItemGroup>
    );
});
