import type { Metadata } from '@happier-dev/session-core/state';
import type { ToolCall } from "@happier-dev/session-core/messages";
import * as z from 'zod';
import { ICON_EDIT } from '../icons';
import type { KnownToolDefinition } from '../_types';
import { resolveDiffToolHeaderPresentation } from '../resolveDiffToolHeaderPresentation';

export const providerDiffTools = {
    'CodexDiff': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return resolveDiffToolHeaderPresentation({ tool: opts.tool }).title;
        },
        icon: ICON_EDIT,
        minimal: false,  // Show full diff view
        hideDefaultError: true,
        noStatus: true,  // Always successful, stateless like Task
        input: z.object({
            unified_diff: z.string().describe('Unified diff content')
        }).partial().passthrough(),
        result: z.object({
            status: z.literal('completed').describe('Always completed')
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return resolveDiffToolHeaderPresentation({ tool: opts.tool }).subtitle;
        },
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return resolveDiffToolHeaderPresentation({ tool: opts.tool }).description;
        }
    },
    'GeminiDiff': {
        title: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return resolveDiffToolHeaderPresentation({
                tool: opts.tool,
                filePathFallback: typeof opts.tool.input?.filePath === 'string' ? opts.tool.input.filePath : null,
            }).title;
        },
        icon: ICON_EDIT,
        minimal: false,  // Show full diff view
        hideDefaultError: true,
        noStatus: true,  // Always successful, stateless like Task
        input: z.object({
            unified_diff: z.string().optional().describe('Unified diff content'),
            filePath: z.string().optional().describe('File path'),
            description: z.string().optional().describe('Edit description')
        }).partial().passthrough(),
        result: z.object({
            status: z.literal('completed').describe('Always completed')
        }).partial().passthrough(),
        extractSubtitle: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return resolveDiffToolHeaderPresentation({
                tool: opts.tool,
                filePathFallback: typeof opts.tool.input?.filePath === 'string' ? opts.tool.input.filePath : null,
            }).subtitle;
        },
        extractDescription: (opts: { metadata: Metadata | null, tool: ToolCall }) => {
            return resolveDiffToolHeaderPresentation({
                tool: opts.tool,
                filePathFallback: typeof opts.tool.input?.filePath === 'string' ? opts.tool.input.filePath : null,
            }).description;
        }
    },
} satisfies Record<string, KnownToolDefinition>;
