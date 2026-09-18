import assert from 'node:assert/strict';
import test from 'node:test';

function createHostActions(mode) {
  const calls = [];
  return {
    calls,
    async execute(actionId, input, options) {
      calls.push({ actionId, input, signal: options?.signal });
      if (mode === 'revoked' && actionId === 'teams.credentials.test') {
        const error = new Error('The current resource grant was revoked');
        error.code = 'team_credential_resource_access_denied';
        throw error;
      }
      if (mode === 'stale' && actionId === 'teams.credentials.usage.query') {
        const error = new Error('The selected resource revision is no longer current');
        error.code = 'team_credential_resource_revision_conflict';
        throw error;
      }
      if (actionId === 'teams.credentials.list') return { resources: [{ id: 'resource-1' }], viewer: {} };
      if (actionId === 'teams.credentials.entitled.list') return { resources: [{ id: 'resource-1' }] };
      if (actionId === 'teams.credentials.test') return { result: 'available', readiness: { kind: 'available' } };
      if (actionId === 'teams.credentials.usage.query') {
        return { totals: { requestCount: 7 }, secretSentinel: 'must-not-cross-example-output' };
      }
      if (actionId === 'secrets.shared.list') {
        return { resources: [{ ref: 'saved-secret-1', value: 'must-not-cross-example-output' }] };
      }
      if (actionId === 'teams.credentials.update' && mode === 'approval') {
        return { kind: 'approval_request_created', artifactId: 'approval-1', actionId };
      }
      if (actionId === 'teams.credentials.update') return { id: 'resource-1', revision: 5 };
      throw new Error(`Unexpected Action ${actionId}`);
    },
  };
}

async function activateExample(actions) {
  const registrations = new Map();
  const { activate, manifest } = await import('../index.ts');
  activate({ actions: { register: (id, handler) => registrations.set(id, handler) } });
  return { manifest, handler: registrations.get('inspect'), actions };
}

const input = {
  teamId: 'team-1',
  resourceId: 'resource-1',
  expectedRevision: 4,
  displayName: 'Renamed resource',
};

test('declares and activates the external-style public Action consumer', async () => {
  const actions = createHostActions('allowed');
  const { manifest, handler } = await activateExample(actions);
  assert.equal(manifest.id, 'examples.team-credential-administrator');
  assert.deepEqual(
    manifest.contributes.actions.map(({ id, surfaces, execution }) => ({ id, surfaces, execution })),
    [{ id: 'inspect', surfaces: ['plugin'], execution: { target: 'daemon' } }],
  );
  assert.equal(typeof handler, 'function');

  const controller = new AbortController();
  const result = await handler(input, { signal: controller.signal, services: { actions } });
  assert.deepEqual(result, {
    resourceCount: 1,
    entitledCount: 1,
    sharedSecretCount: 1,
    testResult: 'available',
    requestCount: 7,
    update: 'updated',
  });
  assert.equal(JSON.stringify(result).includes('must-not-cross-example-output'), false);
  assert.deepEqual(actions.calls.map(({ actionId }) => actionId), [
    'teams.credentials.list',
    'teams.credentials.entitled.list',
    'teams.credentials.test',
    'teams.credentials.usage.query',
    'secrets.shared.list',
    'teams.credentials.update',
  ]);
  assert.deepEqual(actions.calls[0].input, { teamId: 'team-1' });
  assert.deepEqual(actions.calls[2].input, { teamId: 'team-1', resourceId: 'resource-1' });
  assert.deepEqual(actions.calls[5].input, {
    resourceId: 'resource-1',
    expectedRevision: 4,
    displayName: 'Renamed resource',
  });
  assert.equal(actions.calls.every(({ signal }) => signal === controller.signal), true);
});

test('preserves canonical approval deferral instead of bypassing it', async () => {
  const actions = createHostActions('approval');
  const { handler } = await activateExample(actions);
  const result = await handler(input, { signal: new AbortController().signal, services: { actions } });
  assert.equal(result.update, 'approval_required');
});

for (const [mode, code] of [
  ['revoked', 'team_credential_resource_access_denied'],
  ['stale', 'team_credential_resource_revision_conflict'],
]) {
  test(`does not bypass host ${mode} refusal`, async () => {
    const actions = createHostActions(mode);
    const { handler } = await activateExample(actions);
    await assert.rejects(
      () => handler(input, { signal: new AbortController().signal, services: { actions } }),
      (error) => error?.code === code,
    );
    assert.equal(actions.calls.some(({ actionId }) => actionId === 'teams.credentials.update'), false);
  });
}
