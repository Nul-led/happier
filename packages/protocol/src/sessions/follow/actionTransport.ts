import { getActionSpec } from '../../actions/actionSpecs.js';
import { SessionFollowActionInputSchemasV1, SessionFollowActionOutputSchemasV1, type SessionFollowActionIdV1, type SessionFollowActionOutputV1 } from './actions.js';

/** A schema-valid response must still belong to the exact requested relation. */
export function parseSessionFollowActionResponse<TActionId extends SessionFollowActionIdV1>(
  actionId: TActionId,
  input: unknown,
  payload: unknown,
): SessionFollowActionOutputV1[TActionId] {
  const request: Record<string, unknown> = SessionFollowActionInputSchemasV1[actionId].parse(input);
  const result = SessionFollowActionOutputSchemasV1[actionId].parse(payload);
  const mismatch = () => { throw new Error('session_follow_response_target_mismatch'); };
  if ('follow' in result && result.follow && result.follow.sessionId !== request.sessionId) mismatch();
  if (actionId === 'session.follow.sources.set') {
    const { source } = result as SessionFollowActionOutputV1['session.follow.sources.set'];
    if (source.destinationSessionId !== request.destinationSessionId || source.sourceSessionId !== request.sourceSessionId) mismatch();
  }
  if ('sources' in result && result.sources.some((source) => source.destinationSessionId !== request.destinationSessionId)) mismatch();
  // The schema map associates each Action with its exact result type.
  return result as SessionFollowActionOutputV1[TActionId];
}

/** Project the catalog's method/path and strict input into the domain HTTP request. */
export function resolveSessionFollowActionRequest(actionId: SessionFollowActionIdV1, input: unknown): Readonly<{
  path: string; method: 'GET' | 'PUT' | 'DELETE'; body?: Record<string, unknown>;
}> {
  const data: Record<string, unknown> = SessionFollowActionInputSchemasV1[actionId].parse(input);
  const transport = getActionSpec(actionId).serverTransport;
  if (!transport || !['GET', 'PUT', 'DELETE'].includes(transport.method)) throw new Error('Invalid Follow Action transport');
  const body = { ...data };
  const path = transport.path.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, key: string) => {
    const value = data[key];
    if (typeof value !== 'string') throw new Error('Missing Follow Action path parameter');
    delete body[key];
    return encodeURIComponent(value);
  });
  const method = transport.method as 'GET' | 'PUT' | 'DELETE';
  return { path, method, ...(method === 'PUT' ? { body } : {}) };
}
