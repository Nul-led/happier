import { expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import { computeExternalActionRequestEnvelopeDigestV1, signExternalActionMachineRequestV1, verifyExternalActionMachineRequestV1, signExternalActionApprovalInputV1, verifyExternalActionApprovalInputV1, signExternalActionMachineRpcRequestV1, verifyExternalActionMachineRpcRequestV1 } from './externalActionExecutionAuthorization.js';
import { computeExternalActionSocketRpcRequestDigestV1 } from './externalActionExecutionAuthorization.js';

it('binds a Session input authorization to actual RPC bytes rather than an invented encryption envelope', () => {
  const digestRpc = computeExternalActionSocketRpcRequestDigestV1;
  const request = { method: 'session-a:session.userMessage.send', requestId: 'rpc-a', params: 'opaque-session-ciphertext', target: { kind: 'session' as const, sessionId: 'session-a' } };
  const digest = digestRpc(request);
  expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  for (const changed of [ { method: 'session-a:abort' }, { requestId: 'rpc-b' }, { params: 'other-ciphertext' },
    { target: { kind: 'session' as const, sessionId: 'session-b' } },
  ]) expect(digestRpc({ ...request, ...changed })).not.toBe(digest);
  expect(digestRpc({ ...request, params: { a: 1, b: 2 } })).toBe(digestRpc({ ...request, params: { b: 2, a: 1 } }));
  expect(digestRpc({ ...request, params: undefined })).not.toBe(digestRpc({ ...request, params: null }));
});

it('binds auxiliary RPC to its exact invocation, installation, correlation and opaque payload', () => {
  const key = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
  const request = { authorizationToken: 'parent', effectActionId: 'session.list', target: { kind: 'machine' as const, machineId: 'machine-1' }, installationId: 'installation-1', event: 'rpc-call' as const, method: 'machine-1:read', requestId: 'rpc-1', params: 'encrypted-payload' };
  const signature = signExternalActionMachineRpcRequestV1({ ...request, privateKey: key.secretKey });
  expect(verifyExternalActionMachineRpcRequestV1({ ...request, signature, publicKey: key.publicKey })).toBe(true);
  for (const changed of [{ authorizationToken: 'other' }, { installationId: 'other' }, { event: 'other-event' as const }, { method: 'machine-2:read' }, { requestId: 'rpc-2' }, { params: 'other-ciphertext' }, { target: { kind: 'session' as const, sessionId: 'other' } }]) {
    expect(verifyExternalActionMachineRpcRequestV1({ ...request, ...changed, signature, publicKey: key.publicKey })).toBe(false);
  }
  expect(verifyExternalActionMachineRequestV1({ ...request, method: 'POST', path: request.method, body: request.params, signature, publicKey: key.publicKey })).toBe(false);
});

it('binds protected machine input admission to its own event and complete unsigned payload', () => {
  const key = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(5));
  const request = { authorizationToken: 'invocation', effectActionId: 'session.message.send',
    target: { kind: 'session' as const, sessionId: 'session-1' }, installationId: 'installation-1',
    event: 'session-pending-enqueue-by-machine-v1' as const, method: 'session-pending-enqueue-by-machine-v1',
    requestId: 'request-1', params: { v: 1, sessionId: 'session-1', targetMachineId: 'machine-1',
      localId: 'input-1', content: { t: 'encrypted', c: 'ciphertext' }, requestedAction: 'send_now' } };
  const signature = signExternalActionMachineRpcRequestV1({ ...request, privateKey: key.secretKey });
  expect(verifyExternalActionMachineRpcRequestV1({ ...request, signature, publicKey: key.publicKey })).toBe(true);
  expect(verifyExternalActionMachineRpcRequestV1({ ...request, event: 'rpc-call', signature, publicKey: key.publicKey })).toBe(false);
  expect(verifyExternalActionMachineRpcRequestV1({ ...request,
    params: { ...request.params, localId: 'input-2' }, signature, publicKey: key.publicKey })).toBe(false);
  expect(verifyExternalActionMachineRpcRequestV1({ ...request, event: 'other-event', signature, publicKey: key.publicKey })).toBe(false);
  expect(() => signExternalActionMachineRpcRequestV1({ ...request, event: 'other-event', privateKey: key.secretKey })).toThrow();
});

it('keeps approval input signatures separate from network request signatures', () => {
  const key = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8));
  const approval = { authorizationToken: 'invocation', actionId: 'teams.archive', target: { kind: 'machine' as const, machineId: 'machine-1' }, input: { teamId: 'team-1' } };
  const signature = signExternalActionApprovalInputV1({ ...approval, privateKey: key.secretKey });
  expect(verifyExternalActionApprovalInputV1({ ...approval, signature, publicKey: key.publicKey })).toBe(true);
  expect(verifyExternalActionApprovalInputV1({ ...approval, input: { teamId: 'team-2' }, signature, publicKey: key.publicKey })).toBe(false);
  expect(verifyExternalActionMachineRequestV1({ authorizationToken: 'invocation', effectActionId: 'teams.archive', target: approval.target, installationId: 'installation-1', requestId: 'request-1', method: 'POST', path: 'teams.archive', body: approval.input, signature, publicKey: key.publicKey })).toBe(false);
});

it('binds Machine possession to the invocation and exact downstream request', () => {
  const key = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
  const request = { authorizationToken: 'home-authorization', effectActionId: 'teams.rename', target: { kind: 'machine' as const, machineId: 'machine-1' }, installationId: 'installation-1', requestId: 'request-1', method: 'POST', path: '/v1/teams/t/rename', body: { name: 'Acme', revision: 2 } };
  const signature = signExternalActionMachineRequestV1({ ...request, privateKey: key.secretKey });
  expect(verifyExternalActionMachineRequestV1({ ...request, signature, publicKey: key.publicKey })).toBe(true);
  expect(verifyExternalActionMachineRequestV1({ ...request, body: { revision: 2, name: 'Acme' }, signature, publicKey: key.publicKey })).toBe(true);
  for (const changed of [
    { authorizationToken: 'other-invocation' }, { effectActionId: 'teams.archive' }, { installationId: 'installation-2' }, { requestId: 'request-2' }, { method: 'DELETE' }, { path: '/v1/teams/other/rename' }, { body: { name: 'Other', revision: 2 } },
    { target: { kind: 'machine' as const, machineId: 'machine-2' } },
  ]) expect(verifyExternalActionMachineRequestV1({ ...request, ...changed, signature, publicKey: key.publicKey })).toBe(false);
  expect(verifyExternalActionMachineRequestV1({ ...request, signature, publicKey: tweetnacl.sign.keyPair().publicKey })).toBe(false);
  expect(verifyExternalActionMachineRequestV1({ ...request, signature: 'malformed', publicKey: key.publicKey })).toBe(false);
  const absentBody = { ...request, body: undefined };
  const absentBodySignature = signExternalActionMachineRequestV1({ ...absentBody, privateKey: key.secretKey });
  expect(verifyExternalActionMachineRequestV1({ ...absentBody, body: null, signature: absentBodySignature, publicKey: key.publicKey })).toBe(false);
});

it('binds the exact project member of a Machine target in every signature', () => {
  const key = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(6));
  const target = { kind: 'machine' as const, machineId: 'machine-1', project: { machineId: 'machine-1', directory: '/repo/a', workspaceRefId: 'workspace-1' } };
  const request = { authorizationToken: 'home-authorization', effectActionId: 'workflow.run.start', target, installationId: 'installation-1', requestId: 'request-1', method: 'POST', path: '/v1/workflows/runs', body: {} };
  const signature = signExternalActionMachineRequestV1({ ...request, privateKey: key.secretKey });
  expect(verifyExternalActionMachineRequestV1({ ...request, signature, publicKey: key.publicKey })).toBe(true);
  expect(verifyExternalActionMachineRequestV1({ ...request, target: { ...target, project: { ...target.project, directory: '/repo/b' } }, signature, publicKey: key.publicKey })).toBe(false);

  const rpc = { ...request, event: 'rpc-call' as const, method: 'machine-1:workflow', params: {} };
  const rpcSignature = signExternalActionMachineRpcRequestV1({ ...rpc, privateKey: key.secretKey });
  expect(verifyExternalActionMachineRpcRequestV1({ ...rpc, target: { ...target, project: { ...target.project, workspaceRefId: 'workspace-2' } }, signature: rpcSignature, publicKey: key.publicKey })).toBe(false);
});

it('digests the complete original V1 or opaque V2 envelope without input disclosure', () => {
  const envelope = { v: 2 as const, requestId: 'request-1', target: { kind: 'machine' as const, machineId: 'machine-1' }, payload: { t: 'encrypted' as const, c: 'opaque-ciphertext' } };
  const digest = computeExternalActionRequestEnvelopeDigestV1(envelope);
  expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(computeExternalActionRequestEnvelopeDigestV1({ ...envelope, payload: { t: 'encrypted', c: 'other' } })).not.toBe(digest);
  expect(computeExternalActionRequestEnvelopeDigestV1({ ...envelope, requestId: 'request-2' })).not.toBe(digest);
  expect(computeExternalActionRequestEnvelopeDigestV1({ v: 1, requestId: 'request-1', target: envelope.target, input: { title: 'private' } })).not.toBe(digest);
  const projectEnvelope = { ...envelope, target: { ...envelope.target, project: { machineId: 'machine-1', directory: '/repo/a' } } };
  const projectDigest = computeExternalActionRequestEnvelopeDigestV1(projectEnvelope);
  expect(computeExternalActionRequestEnvelopeDigestV1({ ...projectEnvelope, target: { ...projectEnvelope.target, project: { ...projectEnvelope.target.project, directory: '/repo/b' } } })).not.toBe(projectDigest);
});
