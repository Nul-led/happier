import type { Metadata } from '@happier-dev/session-core/state';
import type { ToolCall, Message } from "@happier-dev/session-core/messages";
import type { ReactNode } from 'react';
import type * as z from 'zod';

export type KnownToolDefinition = {
    title?: string | ((opts: { metadata: Metadata | null, tool: ToolCall }) => string);
    icon: (size: number, color: string, opts?: { metadata: Metadata | null, tool: ToolCall }) => ReactNode;
    noStatus?: boolean;
    hideDefaultError?: boolean;
    isMutable?: boolean;
    input?: z.ZodObject<any>;
    result?: z.ZodObject<any>;
    minimal?: boolean | ((opts: { metadata: Metadata | null, tool: ToolCall, messages?: Message[] }) => boolean);
    extractDescription?: (opts: { metadata: Metadata | null, tool: ToolCall }) => string;
    extractSubtitle?: (opts: { metadata: Metadata | null, tool: ToolCall }) => string | null;
    extractStatus?: (opts: { metadata: Metadata | null, tool: ToolCall }) => string | null;
};
