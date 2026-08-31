import { describe, expect, it } from 'vitest';
import {
  BrokerControlFrameDecoder,
  BrokerProtocolError,
  BrokerRequestStateMachine,
  createBrokerHelloProof,
  deriveWorkspaceSyncEndpointId,
  encodeBrokerControlFrame,
  isBrokerTerminalErrorCode,
  parseBrokerControlV1,
  WORKSPACE_SYNC_BROKER_COMMAND_DEADLINE_MS,
} from './workspaceSyncBrokerProtocol';
const validPolicy = { selection: 'all_files' as const, extraIgnorePatterns: [], extraIncludePatterns: [], includeGitDirectory: false };

describe('workspace sync broker protocol', () => {
  it('frames control JSON with a big-endian length and decodes fragmented input', () => {
    const frame = encodeBrokerControlFrame({ t: 'open_data', requestId: 'r1', endpointId: 'ws1_ep', expiresAtMs: 100 });
    expect(frame.readUInt32BE(0)).toBe(frame.byteLength - 4);
    const decoder = new BrokerControlFrameDecoder();
    expect(decoder.push(frame.subarray(0, 2))).toEqual([]);
    expect(decoder.push(frame.subarray(2))).toEqual([{ t: 'open_data', requestId: 'r1', endpointId: 'ws1_ep', expiresAtMs: 100 }]);
  });

  it('rejects unknown fields and oversized frames', () => {
    expect(() => parseBrokerControlV1({ t: 'open_data', requestId: 'r', endpointId: 'e', expiresAtMs: 1, extra: true })).toThrow(/unknown broker control field/);
    const decoder = new BrokerControlFrameDecoder();
    const bad = Buffer.alloc(4); bad.writeUInt32BE(65 * 1024);
    expect(() => decoder.push(bad)).toThrow(/invalid broker frame length/);
    expect(() => parseBrokerControlV1({ t: 'command', requestId: 'outer', command: { t: 'list', requestId: 'inner', nope: true } })).toThrow(/unknown mutagen command field/);
  });

  it('uses a stable length-delimited hello proof', () => {
    const hello = { protocol: 1 as const, brokerInstanceId: 'b', launchNonce: 'n', sidecarPid: 42 };
    expect(createBrokerHelloProof(Buffer.alloc(32, 1), hello)).toBe(createBrokerHelloProof(Buffer.alloc(32, 1), hello));
    expect(createBrokerHelloProof(Buffer.alloc(32, 1), hello)).not.toBe(createBrokerHelloProof(Buffer.alloc(32, 2), hello));
  });

  it('derives opaque endpoint ids deterministically from relationship id and role', () => {
    const alpha = deriveWorkspaceSyncEndpointId('rel-1', 'alpha');
    expect(alpha).toMatch(/^ws1_[a-z2-7]{32}$/u);
    expect(alpha).toBe('ws1_hjjfzd5njl4rdwegflylq5wsramkjhnk');
    expect(deriveWorkspaceSyncEndpointId('rel-1', 'alpha')).toBe(alpha);
    expect(deriveWorkspaceSyncEndpointId('rel-1', 'beta')).not.toBe(alpha);
    expect(deriveWorkspaceSyncEndpointId('rel-2', 'alpha')).not.toBe(alpha);
    expect(() => deriveWorkspaceSyncEndpointId('', 'alpha')).toThrow();
    expect(() => deriveWorkspaceSyncEndpointId('rel-1', 'gamma' as 'alpha')).toThrow();
  });

  it('exposes typed terminal error codes and a typed protocol error', () => {
    expect(isBrokerTerminalErrorCode('relationship_not_owned')).toBe(true);
    expect(isBrokerTerminalErrorCode('something_else')).toBe(false);
    const error = new BrokerProtocolError('root_mismatch', 'root changed');
    expect(error.code).toBe('root_mismatch');
    expect(isBrokerTerminalErrorCode((error as { code?: unknown }).code)).toBe(true);
    expect(WORKSPACE_SYNC_BROKER_COMMAND_DEADLINE_MS).toBeGreaterThan(0);
  });

  it('validates the fork-owned generic manager command union', () => {
    const session = {
      alpha: 'external://opaque-alpha',
      beta: 'external://opaque-beta',
      mode: 'one-way-safe' as const,
      contentPolicy: validPolicy,
      name: 'rel-1',
      labels: { 'external.owner': 'happier-workspace-sync' },
    };
    expect(() => parseBrokerControlV1({ t: 'command', requestId: 'r1', command: { t: 'create', requestId: 'r1', session } })).not.toThrow();
    expect(() => parseBrokerControlV1({ t: 'command', requestId: 'r1', command: { t: 'create', requestId: 'r1', session: { ...session, alpha: '/tmp/source' } } })).toThrow(/external/);
    expect(() => parseBrokerControlV1({ t: 'command', requestId: 'r1', command: { t: 'resume', requestId: 'r1', sessionIdentifier: 'mutagen-session-1' } })).not.toThrow();
    expect(() => parseBrokerControlV1({ t: 'command', requestId: 'r1', command: { t: 'resume', requestId: 'r1', relationshipId: 'rel-1' } })).toThrow();
    expect(() => parseBrokerControlV1({ t: 'command', requestId: 'r1', command: { t: 'copy_once', requestId: 'r1' } })).toThrow(/unknown mutagen control command/);
    expect(() => parseBrokerControlV1({ t: 'command', requestId: 'r1', command: { t: 'delete_conflict_loser', requestId: 'r1' } })).toThrow(/unknown mutagen control command/);
    expect(() => parseBrokerControlV1({ t: 'command', requestId: 'r1', command: { t: 'bogus', requestId: 'r1' } })).toThrow(/unknown mutagen control command/);
  });

  it('enforces the explicit request state machine', () => {
    const state = new BrokerRequestStateMachine();
    state.transition('CONTROL_AUTHENTICATING'); state.transition('CONTROL_READY'); state.transition('OPEN_VALIDATING');
    expect(() => state.transition('STREAMING')).toThrow(/invalid broker state transition/);
    state.fail(); expect(state.state).toBe('CLOSED');
  });
});
