import { z } from 'zod';

import {
  SessionDiscussionAccountIdSchema,
  SessionDiscussionIdSchema,
  SessionDiscussionLocalIdSchema,
  SessionDiscussionMessageContentV1Schema,
  SessionDiscussionTitleV1Schema,
} from '../../sessions/discussions/content.js';
import type { ActionCliBindContext, ActionCliProjection } from '../actionCliProjection.js';
import type { ActionInputHints } from '../metadata.js';

const SessionSelectorSchema = z.string().trim().min(1);
const MentionedAccountIdsSchema = z.array(SessionDiscussionAccountIdSchema).refine(
  (value) => new Set(value).size === value.length,
  'Mentioned Account ids must be deduplicated',
);
const AuthoredTextSchema = z.string().refine((value) => value.trim().length > 0, {
  message: 'message must not be blank',
});

/**
 * The friendly create spelling is intentionally a scalar projection. The
 * canonical Action still owns the structured content schema and validates the
 * bound document; argv parsing never becomes another discussion input model.
 */
export const SessionDiscussionCreateCliInputSchema = z.object({
  sessionId: SessionSelectorSchema,
  title: AuthoredTextSchema,
  message: AuthoredTextSchema,
  mentionedAccountIds: MentionedAccountIdsSchema.optional(),
  creationLocalId: SessionDiscussionLocalIdSchema.optional(),
  messageLocalId: SessionDiscussionLocalIdSchema.optional(),
}).strict();
export type SessionDiscussionCreateCliInput = z.infer<typeof SessionDiscussionCreateCliInputSchema>;

export const SessionDiscussionPostCliInputSchema = z.object({
  sessionId: SessionSelectorSchema,
  discussionId: SessionDiscussionIdSchema,
  message: AuthoredTextSchema,
  mentionedAccountIds: MentionedAccountIdsSchema.optional(),
  localId: SessionDiscussionLocalIdSchema.optional(),
}).strict();
export type SessionDiscussionPostCliInput = z.infer<typeof SessionDiscussionPostCliInputSchema>;

export const SessionDiscussionRenameCliInputSchema = z.object({
  sessionId: SessionSelectorSchema,
  discussionId: SessionDiscussionIdSchema,
  title: AuthoredTextSchema,
}).strict();
export type SessionDiscussionRenameCliInput = z.infer<typeof SessionDiscussionRenameCliInputSchema>;

function normalizeAuthoredCliText(value: string): string {
  return value.normalize('NFC');
}

function textContent(text: string) {
  return SessionDiscussionMessageContentV1Schema.parse({
    v: 1,
    parts: [{ t: 'text', text: normalizeAuthoredCliText(text) }],
  });
}

export function bindSessionDiscussionCreateCliInput(
  value: SessionDiscussionCreateCliInput,
  context: ActionCliBindContext,
): Readonly<Record<string, unknown>> {
  return {
    sessionId: value.sessionId,
    creationLocalId: value.creationLocalId ?? `discussion-${context.invocationId}`,
    title: SessionDiscussionTitleV1Schema.shape.title.parse(normalizeAuthoredCliText(value.title)),
    firstMessage: {
      localId: value.messageLocalId ?? `message-${context.invocationId}`,
      content: textContent(value.message),
      mentionedAccountIds: value.mentionedAccountIds ?? [],
    },
  };
}

export function bindSessionDiscussionRenameCliInput(
  value: SessionDiscussionRenameCliInput,
): Readonly<Record<string, unknown>> {
  return {
    sessionId: value.sessionId,
    discussionId: value.discussionId,
    title: SessionDiscussionTitleV1Schema.shape.title.parse(normalizeAuthoredCliText(value.title)),
  };
}

export function bindSessionDiscussionPostCliInput(
  value: SessionDiscussionPostCliInput,
  context: ActionCliBindContext,
): Readonly<Record<string, unknown>> {
  return {
    sessionId: value.sessionId,
    discussionId: value.discussionId,
    localId: value.localId ?? context.invocationId,
    content: textContent(value.message),
    mentionedAccountIds: value.mentionedAccountIds ?? [],
  };
}

const CREATE_HINTS: ActionInputHints = {
  title: 'Start a discussion',
  fields: [
    { path: 'sessionId', title: 'Session id or prefix', widget: 'text', required: true },
    { path: 'title', title: 'Discussion title', widget: 'text', required: true },
    { path: 'message', title: 'First message', widget: 'textarea', required: true },
    { path: 'mentionedAccountIds', title: 'Mentioned Account id', widget: 'text_list', listSeparator: 'comma' },
    { path: 'creationLocalId', title: 'Durable discussion identity for retry', widget: 'text' },
    { path: 'messageLocalId', title: 'Durable first-message identity for retry', widget: 'text' },
  ],
};

const POST_HINTS: ActionInputHints = {
  title: 'Post to a discussion',
  fields: [
    { path: 'sessionId', title: 'Session id or prefix', widget: 'text', required: true },
    { path: 'discussionId', title: 'Discussion id', widget: 'text', required: true },
    { path: 'message', title: 'Message', widget: 'textarea', required: true },
    { path: 'mentionedAccountIds', title: 'Mentioned Account id', widget: 'text_list', listSeparator: 'comma' },
    { path: 'localId', title: 'Durable message identity for retry', widget: 'text' },
  ],
};

export const SESSION_DISCUSSION_LIST_CLI_PROJECTION: ActionCliProjection = {
  acceptsServerId: true,
  commands: [{ path: ['session', 'discussions', 'list'], positionals: ['sessionId'], visibility: 'canonical' }],
};

export const SESSION_DISCUSSION_GET_CLI_PROJECTION: ActionCliProjection = {
  acceptsServerId: true,
  commands: [{ path: ['session', 'discussions', 'show'], positionals: ['sessionId', 'discussionId'], visibility: 'canonical' }],
};

export const SESSION_DISCUSSION_READ_CLI_PROJECTION: ActionCliProjection = {
  acceptsServerId: true,
  commands: [{ path: ['session', 'discussions', 'read'], positionals: ['sessionId', 'discussionId'], visibility: 'canonical' }],
};

export const SESSION_DISCUSSION_CREATE_CLI_PROJECTION: ActionCliProjection = {
  acceptsServerId: true,
  commands: [{
    path: ['session', 'discussions', 'create'],
    positionals: ['sessionId', 'title', 'message'],
    visibility: 'canonical',
  }],
  inputSchema: SessionDiscussionCreateCliInputSchema,
  inputHints: CREATE_HINTS,
  bindInput: (value, context) => bindSessionDiscussionCreateCliInput(
    value as SessionDiscussionCreateCliInput,
    context,
  ),
};

export const SESSION_DISCUSSION_POST_CLI_PROJECTION: ActionCliProjection = {
  acceptsServerId: true,
  commands: [{
    path: ['session', 'discussions', 'post'],
    positionals: ['sessionId', 'discussionId', 'message'],
    visibility: 'canonical',
  }],
  inputSchema: SessionDiscussionPostCliInputSchema,
  inputHints: POST_HINTS,
  bindInput: (value, context) => bindSessionDiscussionPostCliInput(
    value as SessionDiscussionPostCliInput,
    context,
  ),
};

export const SESSION_DISCUSSION_RENAME_CLI_PROJECTION: ActionCliProjection = {
  acceptsServerId: true,
  commands: [{
    path: ['session', 'discussions', 'rename'],
    positionals: ['sessionId', 'discussionId', 'title'],
    visibility: 'canonical',
  }],
  inputSchema: SessionDiscussionRenameCliInputSchema,
  inputHints: {
    title: 'Rename a discussion',
    fields: [
      { path: 'sessionId', title: 'Session id or prefix', widget: 'text', required: true },
      { path: 'discussionId', title: 'Discussion id', widget: 'text', required: true },
      { path: 'title', title: 'Discussion title', widget: 'text', required: true },
    ],
  },
  bindInput: (value) => bindSessionDiscussionRenameCliInput(value as SessionDiscussionRenameCliInput),
};

export const SESSION_DISCUSSION_ARCHIVE_CLI_PROJECTION: ActionCliProjection = {
  acceptsServerId: true,
  commands: [{ path: ['session', 'discussions', 'archive'], positionals: ['sessionId', 'discussionId'], visibility: 'canonical' }],
};

export const SESSION_DISCUSSION_RESTORE_CLI_PROJECTION: ActionCliProjection = {
  acceptsServerId: true,
  commands: [{ path: ['session', 'discussions', 'restore'], positionals: ['sessionId', 'discussionId'], visibility: 'canonical' }],
};

export const SESSION_DISCUSSION_READ_STATE_SET_CLI_PROJECTION: ActionCliProjection = {
  acceptsServerId: true,
  commands: [{
    path: ['session', 'discussions', 'read-state'],
    positionals: ['sessionId', 'discussionId', 'lastReadSeq'],
    visibility: 'canonical',
  }],
};
