import { definePlugin, PluginError } from '@happier-dev/plugin-sdk';
import {
  isPluginActionApprovalRequestCreated,
  type ActionApprovalRequestCreatedResult,
  type PluginActionResultById,
} from '@happier-dev/plugin-sdk/actions';
import {
  defineProtocolLiteral,
  defineProtocolNumber,
  defineProtocolObject,
  defineProtocolString,
  defineProtocolUnion,
} from '@happier-dev/plugin-sdk/protocol';

const inputSchema = defineProtocolObject({
  teamId: defineProtocolString(),
  resourceId: defineProtocolString(),
  expectedRevision: defineProtocolNumber({
    integer: true,
    minimum: 0,
  }),
  displayName: defineProtocolString().optional(),
}, { policy: 'closed' });

const resultSchema = defineProtocolObject({
  resourceCount: defineProtocolNumber({ integer: true, minimum: 0 }),
  entitledCount: defineProtocolNumber({ integer: true, minimum: 0 }),
  sharedSecretCount: defineProtocolNumber({ integer: true, minimum: 0 }),
  testResult: defineProtocolUnion([
    defineProtocolLiteral('available'),
    defineProtocolLiteral('needs_attention'),
    defineProtocolLiteral('partially_available'),
  ]),
  requestCount: defineProtocolNumber({ integer: true, minimum: 0 }),
  update: defineProtocolUnion([
    defineProtocolLiteral('not_requested'),
    defineProtocolLiteral('approval_required'),
    defineProtocolLiteral('updated'),
  ]),
}, { policy: 'closed' });

function requireExecuted<T>(
  result: T | ActionApprovalRequestCreatedResult,
): T {
  if (isPluginActionApprovalRequestCreated(result)) {
    throw new PluginError({
      code: 'team_credential_approval_required',
      message: `Approval is pending in ${result.artifactId}`,
    });
  }
  return result;
}

export const { manifest, activate } = definePlugin({
  id: 'examples.team-credential-administrator',
  version: '0.1.0',
  displayName: 'Team credential administrator example',
  description: 'Uses only public host Actions; the host remains the resource, authority, approval, and currentness owner.',
  entrypoints: { daemon: './dist/index.js' },
  actions: {
    inspect: {
      title: 'Inspect Team credential resource',
      description: 'Exercises the public credential catalog, test, usage, Saved Secret, and optional administration Actions.',
      execution: { target: 'daemon' },
      surfaces: ['plugin'],
      inputSchema,
      resultSchema,
      async run(input, context) {
        const [catalogResult, entitledResult, testResult, usageResult, secretsResult] = await Promise.all([
          context.services.actions.execute('teams.credentials.list', { teamId: input.teamId }, { signal: context.signal }),
          context.services.actions.execute('teams.credentials.entitled.list', { teamId: input.teamId }, { signal: context.signal }),
          context.services.actions.execute('teams.credentials.test', {
            teamId: input.teamId,
            resourceId: input.resourceId,
          }, { signal: context.signal }),
          context.services.actions.execute('teams.credentials.usage.query', {
            resourceId: input.resourceId,
            startMs: 0,
            endMs: Date.now(),
          }, { signal: context.signal }),
          context.services.actions.execute('secrets.shared.list', {}, { signal: context.signal }),
        ]);

        const catalog = requireExecuted<PluginActionResultById['teams.credentials.list']>(catalogResult);
        const entitled = requireExecuted<PluginActionResultById['teams.credentials.entitled.list']>(entitledResult);
        const tested = requireExecuted<PluginActionResultById['teams.credentials.test']>(testResult);
        const usage = requireExecuted<PluginActionResultById['teams.credentials.usage.query']>(usageResult);
        const secrets = requireExecuted<PluginActionResultById['secrets.shared.list']>(secretsResult);

        let update: 'not_requested' | 'approval_required' | 'updated' = 'not_requested';
        if (input.displayName !== undefined) {
          const updateResult = await context.services.actions.execute('teams.credentials.update', {
            resourceId: input.resourceId,
            expectedRevision: input.expectedRevision,
            displayName: input.displayName,
          }, { signal: context.signal });
          update = isPluginActionApprovalRequestCreated(updateResult) ? 'approval_required' : 'updated';
        }

        return {
          resourceCount: catalog.resources.length,
          entitledCount: entitled.resources.length,
          sharedSecretCount: secrets.resources.length,
          testResult: tested.result,
          requestCount: usage.totals.requestCount,
          update,
        };
      },
    },
  },
});
