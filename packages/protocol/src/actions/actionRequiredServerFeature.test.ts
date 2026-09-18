import { describe, expect, it } from 'vitest';

import { getActionRequiredServerFeatureId } from './actionRequiredServerFeature.js';

describe('getActionRequiredServerFeatureId', () => {
  it('owns the server feature required by each gated Action family', () => {
    expect(getActionRequiredServerFeatureId('workflow.run.start')).toBe('workflows');
    expect(getActionRequiredServerFeatureId('workflow.definition.get')).toBe('workflows');
    expect(getActionRequiredServerFeatureId('workflow.unknown')).toBeNull();
    expect(getActionRequiredServerFeatureId('session.discussion.list')).toBe('sessions.conversations');
    expect(getActionRequiredServerFeatureId('session.discussion.post')).toBe('sessions.conversations');
    expect(getActionRequiredServerFeatureId('session.board.get')).toBe('sessions.board');
    expect(getActionRequiredServerFeatureId('session.board.item.upsert')).toBe('sessions.board');
    expect(getActionRequiredServerFeatureId('session.board.item.remove')).toBe('sessions.board');
    expect(getActionRequiredServerFeatureId('session.board.layout.update')).toBe('sessions.board');
    expect(getActionRequiredServerFeatureId('teams.credentials.list')).toBe('teams.credentialResources');
    expect(getActionRequiredServerFeatureId('teams.credentials.create')).toBe('teams.credentialResources');
    expect(getActionRequiredServerFeatureId('teams.credentials.externalKeys.list'))
      .toBe('teams.credentialResources.externalApi');
    expect(getActionRequiredServerFeatureId('teams.credentials.externalKeys.create'))
      .toBe('teams.credentialResources.externalApi');
    expect(getActionRequiredServerFeatureId('secrets.shared.list')).toBe('teams.credentialResources');
    expect(getActionRequiredServerFeatureId('secrets.shared.update')).toBe('teams.credentialResources');
    expect(getActionRequiredServerFeatureId('account.apiTokens.create')).toBeNull();
    expect(getActionRequiredServerFeatureId('session.title.set')).toBeNull();
  });
});
