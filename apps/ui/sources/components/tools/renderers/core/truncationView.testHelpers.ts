import type { ReactTestRenderer } from 'react-test-renderer';
import type { ToolCall } from "@happier-dev/session-core/messages";
import { collectHostText, makeToolCall } from '@/dev/testkit';

export function makeCompletedTool(
    name: ToolCall['name'],
    input: ToolCall['input'],
    result: ToolCall['result'],
): ToolCall {
    return makeToolCall({
        name,
        state: 'completed',
        input,
        result,
    });
}

export function normalizedHostText(tree: ReactTestRenderer): string {
    return collectHostText(tree).join(' ').replace(/\s+/g, ' ').trim();
}
