import { describe, expect, it } from 'vitest';

import { SESSION_RPC_METHODS, resolveSocketRpcSessionAuthorization } from '@happier-dev/protocol/rpc';

import { SESSION_TRANSCRIPT_RPC_SCOPES } from './actionSpecRpcRegistration';
import { registerActionSpecRpcHandlers } from './registerActionSpecRpcHandlers';
import { registerSessionControlHandlers } from './sessionControls';
import { registerSessionUserMessageSendHandler } from './sessionUserMessageSend';

describe('Session RPC registration authorization coverage', () => {
  it('classifies every method installed on the Session RPC registrar', () => {
    const methods = new Set<string>();
    const registrar = {
      hasHandler: (method: string) => methods.has(method),
      registerHandler: (method: string) => {
        methods.add(method);
      },
    };

    registerSessionUserMessageSendHandler(registrar, {
      workingDirectory: '/workspace',
      sessionId: 'session-1',
      getSessionMetadata: null,
      enqueueSessionUserMessage: async () => undefined,
      sessionRuntimeControls: null,
    });
    registerSessionControlHandlers(registrar, {
      getSessionMetadata: null,
      isUsageLimitRecoveryEnabled: null,
      sessionRuntimeControls: null,
      notifyUsageLimitWaitResumeCancelled: null,
    });
    registerActionSpecRpcHandlers({
      rpcHandlerManager: registrar,
      scopes: SESSION_TRANSCRIPT_RPC_SCOPES,
      actionExecutor: {
        execute: async () => ({ ok: false, errorCode: 'not_executed', error: 'not_executed' }),
      },
    });

    expect(
      [...methods]
        .filter((method) => resolveSocketRpcSessionAuthorization(method) === null)
        .sort(),
    ).toEqual([]);
    for (const method of [
      SESSION_RPC_METHODS.SESSION_USER_MESSAGE_SEND,
      SESSION_RPC_METHODS.SESSION_VENDOR_PLUGIN_CATALOG_LIST,
      SESSION_RPC_METHODS.SESSION_SKILL_CATALOG_LIST,
    ]) {
      expect(methods.has(method), method).toBe(true);
    }
    for (const dynamicallyRegisteredMethod of [
      'session.permission_mode.set',
      'session.permission.respond',
      'session.permission.remote.grants.list',
      'session.permission.remote.grants.revoke',
      'session.user_action.answer',
    ]) {
      expect(resolveSocketRpcSessionAuthorization(dynamicallyRegisteredMethod), dynamicallyRegisteredMethod)
        .not.toBeNull();
    }
  });
});
