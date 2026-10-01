import type { Message } from "@happier-dev/session-core/messages";

export function readStructuredUserMessageText(message: Message): string | null {
    if (message.kind !== 'user-text') return null;
    const text = (message.displayText ?? message.text ?? '').trim();
    return text.length > 0 ? text : null;
}
