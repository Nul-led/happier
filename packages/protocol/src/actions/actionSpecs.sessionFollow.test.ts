import { describe, expect, it } from 'vitest';
import { getActionSpec } from './actionSpecs.js';
import { parseSessionFollowActionResponse } from '../sessions/follow/actionTransport.js';

describe('Follow Action contracts', () => {
  it('rejects source projections belonging to a different destination or source', () => {
    const source = {
      sourceSessionId: 'source',
      destinationSessionId: 'other',
      deliveryState: 'eligible',
      hasPendingUpdates: false,
    };
    expect(() => parseSessionFollowActionResponse('session.follow.sources.list', { destinationSessionId: 'destination' }, { sources: [source] })).toThrow('session_follow_response_target_mismatch');
    expect(() => parseSessionFollowActionResponse('session.follow.sources.set', { destinationSessionId: 'destination', sourceSessionId: 'source' }, { changed: true, source })).toThrow('session_follow_response_target_mismatch');
  });
  it('keeps every Follow operation at Account placement with shared approval and generated surfaces', () => {
    const expected = [
      ['session.follow.get', 'safe', 'required'],
      ['session.follow.set', 'safe', 'optional'],
      ['session.follow.remove', 'safe', 'optional'],
      ['session.follow.preferences.get', 'safe', 'required'],
      ['session.follow.preferences.set', 'safe', 'optional'],
      ['session.follow.sources.list', 'safe', 'none'],
      ['session.follow.sources.set', 'danger', 'optional'],
      ['session.follow.sources.remove', 'danger', 'optional'],
    ] as const;
    for (const [id, safety, result] of expected) {
      const spec = getActionSpec(id);
      expect(spec.executionPlacement).toBe('account');
      expect(spec.requiredAuthority).toBe('account_automation');
      expect(spec.safety).toBe(safety);
      expect(spec.approval.result).toBe(result);
      if (result === 'optional') expect(spec.approval.flow).toBe('deferred');
      expect(spec.surfaces).toMatchObject({ ui: true, cli: true, mcp: true, agent: true });
      expect(spec.cli?.commands.some((command) => command.visibility === 'canonical')).toBe(true);
    }
  });
  it('projects required on/off CLI preferences into complete Boolean replacements', () => {
    const spec = getActionSpec('session.follow.preferences.set');
    const flags = { assigned: 'on', direct: 'off', team: 'on', group: 'off' };
    expect(spec.cli?.inputSchema?.safeParse(flags).success).toBe(true);
    expect(spec.cli?.inputSchema?.safeParse({ assigned: 'on' }).success).toBe(false);
    expect(spec.cli?.bindInput?.(flags, { actionId: spec.id, invocationId: 'test' })).toEqual({ assigned: true, direct: false, team: true, group: false });
  });

  it('exposes strict Account preference replacement without a Session placement', () => {
    const get = getActionSpec('session.follow.preferences.get');
    const set = getActionSpec('session.follow.preferences.set');
    expect(get.inputSchema.safeParse({ sessionId: 'wrong-scope' }).success).toBe(false);
    expect(set.inputSchema.safeParse({ autoFollowAssigned: true }).success).toBe(false);
    expect(set.executionPlacement).toBe('account');
    expect(set.serverTransport).toEqual({ method: 'PUT', path: '/v2/account/session-follow-preferences' });
  });
  it('rejects untrusted source fields and malformed successful results', () => {
    const spec = getActionSpec('session.follow.sources.set');
    expect(spec.inputSchema.safeParse({ destinationSessionId: 'dest', sourceSessionId: 'src' }).success).toBe(true);
    expect(spec.inputSchema.safeParse({ destinationSessionId: 'dest', sourceSessionId: 'src', mode: 'next_turn' }).success).toBe(true);
    expect(spec.inputSchema.safeParse({ destinationSessionId: 'dest', sourceSessionId: 'src', mode: 'wake_on_human_change' }).success).toBe(true);
    expect(spec.inputSchema.safeParse({ destinationSessionId: 'dest', sourceSessionId: 'src', mode: 'unknown' }).success).toBe(false);
    expect(spec.inputSchema.safeParse({ destinationSessionId: 'dest', sourceSessionId: 'src', executionAccountId: 'other' }).success).toBe(false);
    expect(spec.outputSchema.safeParse({ arbitrary: true }).success).toBe(false);
  });
});
