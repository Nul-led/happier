import { definitionList, ok } from '@happier-dev/cli-common/output';
import {
  SessionDiscussionCreateResultV1Schema,
  SessionDiscussionDetailsResultV1Schema,
  SessionDiscussionListResultV1Schema,
  SessionDiscussionPostResultV1Schema,
  SessionDiscussionReadResultV1Schema,
  SessionDiscussionReadStateResultV1Schema,
  type SessionDiscussionMessageContentV1,
  type SessionDiscussionOpenedMessageV1,
  type SessionDiscussionOpenedSummaryV1,
} from '@happier-dev/protocol';

import type {
  ActionCliPresentation,
  ActionCliPresentationContext,
} from '@/cli/actions/commandPresentation';
import { printJsonEnvelope } from '@/cli/output/jsonEnvelope';

function envelopeKind(context: ActionCliPresentationContext): string {
  return context.command.path.join('_').replace(/-/gu, '_');
}

function successPresentation<T>(params: Readonly<{
  parse: (payload: unknown) => T;
  human: (result: T) => void;
}>): ActionCliPresentation {
  return {
    presentSuccess: async (payload, context) => {
      const result = params.parse(payload);
      if (context.json) {
        await printJsonEnvelope({ ok: true, kind: envelopeKind(context), data: result });
      } else {
        params.human(result);
      }
      return true;
    },
  };
}

function titleOf(discussion: SessionDiscussionOpenedSummaryV1): string {
  return discussion.title ?? '[title unavailable]';
}

function stateOf(discussion: SessionDiscussionOpenedSummaryV1): string {
  const state = discussion.archivedAt === null ? 'active' : 'archived';
  const unread = discussion.unreadCount > 0 ? `, ${discussion.unreadCount} unread` : '';
  const mentions = discussion.unreadMentionCount > 0
    ? `, ${discussion.unreadMentionCount} mention${discussion.unreadMentionCount === 1 ? '' : 's'}`
    : '';
  return `${state}${unread}${mentions}`;
}

function renderSummary(discussion: SessionDiscussionOpenedSummaryV1): string {
  return definitionList([
    { label: titleOf(discussion), value: `${discussion.id} (${stateOf(discussion)})` },
  ]);
}

function renderContent(content: SessionDiscussionMessageContentV1): string {
  return content.parts.map((part) => (
    part.t === 'text' ? part.text : '@Happier member'
  )).join('');
}

function renderAccountActor(message: SessionDiscussionOpenedMessageV1): string {
  const actor = message.accountActor;
  if (actor === null) return 'Unknown author';
  const profile = actor.profile;
  if (profile === null) return 'Former member';
  const fullName = [profile.firstName, profile.lastName]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' ');
  if (fullName) return fullName;
  const username = profile.username?.trim();
  return username ? `@${username}` : 'Happier member';
}

export function formatDiscussionMessageForHuman(message: SessionDiscussionOpenedMessageV1): string {
  const actor = renderAccountActor(message);
  const author = message.producerV1?.kind === 'agent' ? `${actor} · Via Agent` : actor;
  const content = message.content === null ? '[content unavailable]' : renderContent(message.content);
  return `${message.seq}. ${author}: ${content}`;
}

function readInputString(input: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function createFailureFields(context: ActionCliPresentationContext) {
  const creationLocalId = readInputString(context.input, 'creationLocalId');
  const firstMessage = context.input.firstMessage;
  const messageLocalId = firstMessage && typeof firstMessage === 'object' && !Array.isArray(firstMessage)
    ? readInputString(firstMessage as Readonly<Record<string, unknown>>, 'localId')
    : null;
  return {
    ...(creationLocalId ? { creationLocalId } : {}),
    ...(messageLocalId ? { messageLocalId } : {}),
  };
}

export const SESSION_DISCUSSION_LIST_PRESENTATION: ActionCliPresentation = successPresentation({
  parse: (payload) => SessionDiscussionListResultV1Schema.parse(payload),
  human: (result) => {
    if (result.discussions.length === 0) {
      console.log('(no discussions)');
      return;
    }
    console.log(definitionList(result.discussions.map((discussion) => ({
      label: titleOf(discussion),
      value: `${discussion.id} (${stateOf(discussion)})`,
    }))));
    if (result.incomplete) console.log('Some discussion content is unavailable.');
  },
});

export const SESSION_DISCUSSION_DETAILS_PRESENTATION: ActionCliPresentation = successPresentation({
  parse: (payload) => SessionDiscussionDetailsResultV1Schema.parse(payload),
  human: (result) => console.log(renderSummary(result.discussion)),
});

export const SESSION_DISCUSSION_READ_PRESENTATION: ActionCliPresentation = successPresentation({
  parse: (payload) => SessionDiscussionReadResultV1Schema.parse(payload),
  human: (result) => {
    if (result.messages.length === 0) console.log('(no messages)');
    for (const message of result.messages) console.log(formatDiscussionMessageForHuman(message));
    if (result.hasMoreOlder) console.log('Older messages are available.');
    if (result.incomplete) console.log('Some message content is unavailable.');
  },
});

export const SESSION_DISCUSSION_CREATE_PRESENTATION: ActionCliPresentation = {
  ...successPresentation({
    parse: (payload) => SessionDiscussionCreateResultV1Schema.parse(payload),
    human: (result) => console.log(ok(`Discussion created: ${titleOf(result.discussion)} (${result.discussion.id})`)),
  }),
  failureFields: (_failure, context) => createFailureFields(context),
  describeFailure: (_failure, context) => {
    const fields = createFailureFields(context);
    return typeof fields.creationLocalId === 'string' && typeof fields.messageLocalId === 'string'
      ? `Retry with --creation-local-id ${fields.creationLocalId} --message-local-id ${fields.messageLocalId}.`
      : null;
  },
};

export const SESSION_DISCUSSION_POST_PRESENTATION: ActionCliPresentation = {
  ...successPresentation({
    parse: (payload) => SessionDiscussionPostResultV1Schema.parse(payload),
    human: (result) => console.log(ok(`Message posted (sequence ${result.messageSeq}, local id ${result.message.localId ?? 'unavailable'})`)),
  }),
  failureFields: (_failure, context) => {
    const localId = readInputString(context.input, 'localId');
    return localId ? { localId } : null;
  },
  describeFailure: (_failure, context) => {
    const localId = readInputString(context.input, 'localId');
    return localId ? `Retry with --local-id ${localId}.` : null;
  },
};

export const SESSION_DISCUSSION_RENAME_PRESENTATION: ActionCliPresentation = successPresentation({
  parse: (payload) => SessionDiscussionDetailsResultV1Schema.parse(payload),
  human: (result) => console.log(ok(`Discussion renamed: ${titleOf(result.discussion)} (${result.discussion.id})`)),
});

export const SESSION_DISCUSSION_ARCHIVE_PRESENTATION: ActionCliPresentation = successPresentation({
  parse: (payload) => SessionDiscussionDetailsResultV1Schema.parse(payload),
  human: (result) => console.log(ok(`Discussion archived: ${titleOf(result.discussion)} (${result.discussion.id})`)),
});

export const SESSION_DISCUSSION_RESTORE_PRESENTATION: ActionCliPresentation = successPresentation({
  parse: (payload) => SessionDiscussionDetailsResultV1Schema.parse(payload),
  human: (result) => console.log(ok(`Discussion restored: ${titleOf(result.discussion)} (${result.discussion.id})`)),
});

export const SESSION_DISCUSSION_READ_STATE_PRESENTATION: ActionCliPresentation = successPresentation({
  parse: (payload) => SessionDiscussionReadStateResultV1Schema.parse(payload),
  human: (result) => console.log(ok(
    result.cursor.didChange
      ? `Discussion marked read through sequence ${result.cursor.lastReadSeq}`
      : `Discussion was already read through sequence ${result.cursor.lastReadSeq}`,
  )),
});
