import type { AgentState, Metadata, OrderedTranscript, SessionPendingRequest } from '@happier-dev/session-core';
import type { SessionPermissionRespondRpcParamsV1, StructuredQuestionAnswersV1 } from '@happier-dev/protocol';
import type { PublicActionResultById } from '../actions/generated.js';

export type HappierSessionLiveOptions = Readonly<{
  history?: Readonly<{ afterSeq?: number }>;
  transport?: 'auto' | 'socket' | 'action';
  signal?: AbortSignal;
}>;

export type HappierSessionSnapshot = Readonly<{
  connection: 'connecting' | 'online' | 'reconnecting' | 'offline' | 'closed' | 'auth_failed';
  history: Readonly<{ loading: boolean; hasMoreOlder: boolean }>;
  transcript: OrderedTranscript;
  metadata: Metadata | null;
  agentState: AgentState | null;
  pendingRequests: readonly SessionPendingRequest[];
  actions: Readonly<{ send: boolean; respondToPermission: boolean; answerUserAction: boolean; abort: boolean }>;
  lockedReason: 'session_content_locked' | null;
}>;

export type HappierSessionController = Readonly<{
  sessionId: string;
  transport: 'socket' | 'action';
  getSnapshot(): HappierSessionSnapshot;
  subscribe(listener: () => void): () => void;
  loadOlder(options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<{ hasMore: boolean }>>;
  send(message: string, options?: Readonly<{ localId?: string; signal?: AbortSignal }>): Promise<PublicActionResultById['session.message.send']>;
  respondToPermission(response: SessionPermissionRespondRpcParamsV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
  answerUserAction(requestId: string, answers: StructuredQuestionAnswersV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
  abort(options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
  close(): Promise<void>;
}>;
