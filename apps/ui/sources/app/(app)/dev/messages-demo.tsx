import * as React from 'react';
import { FlatList, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { MessageView } from '@/components/sessions/transcript/MessageView';
import { debugMessages } from '@/dev/messagesDemoData';
import type { Message } from "@happier-dev/session-core/messages";
import { useDemoMessages } from '@/hooks/session/useDemoMessages';
import { SessionTranscriptSourceProvider } from '@/components/sessions/transcript/source/SessionTranscriptSourceContext';
import { resolveTranscriptHostWakeCountByMessageId } from '@/components/sessions/transcript/events/transcriptEventEmphasis';

export default React.memo(function MessagesDemoScreen() {
    const allMessages = debugMessages;

    const source = useDemoMessages(allMessages);
    const messagesById = source.useMessagesById();
    const hostWakeCountByMessageId = React.useMemo(() => resolveTranscriptHostWakeCountByMessageId({
        messageIdsOldestFirst: allMessages.map((message) => message.id),
        messagesById,
    }), [allMessages, messagesById]);

    return (
        <SessionTranscriptSourceProvider source={source}>
            <View style={styles.container}>
                {allMessages.length > 0 && (
                    <FlatList
                        data={allMessages}
                        keyExtractor={(item) => item.id}
                        renderItem={({ item }) => (
                            <MessageView
                                message={item}
                                metadata={null}
                                sessionId={source.sessionId}
                                getMessageById={(id: string): Message | null => messagesById[id] ?? null}
                                hostWakeCount={hostWakeCountByMessageId[item.id]}
                            />
                        )}
                        style={{ flexGrow: 1, flexBasis: 0 }}
                        contentContainerStyle={{ paddingVertical: 20 }}
                    />
                )}
            </View>
        </SessionTranscriptSourceProvider>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
    },
}));
