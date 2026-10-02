import type { ConversationResolvedEndpointV1 } from '@happier-dev/channels-protocol/v1';
import { PluginError } from '@happier-dev/plugin-sdk';

export function parseGithubChannelEndpoint(
  endpoint: ConversationResolvedEndpointV1,
  repositoryId: string,
): Readonly<{ issueId: string; issueNumber: number; kind: 'githubIssue' | 'githubPullRequest' }> {
  if (endpoint.kind !== 'githubIssue' && endpoint.kind !== 'githubPullRequest') {
    throw new PluginError({ code: 'github_channel_endpoint_invalid', message: 'GitHub delivery requires an issue or pull-request endpoint.' });
  }
  const match = /^github:repository:([1-9][0-9]*):issue:([1-9][0-9]*):number:([1-9][0-9]*)$/u.exec(endpoint.id);
  if (!match || match[1] !== repositoryId) {
    throw new PluginError({ code: 'github_channel_endpoint_invalid', message: 'GitHub delivery endpoint does not belong to this configured repository.' });
  }
  const issueNumber = Number(match[3]);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) {
    throw new PluginError({ code: 'github_channel_endpoint_invalid', message: 'GitHub delivery endpoint has an invalid issue number.' });
  }
  return Object.freeze({ issueId: match[2]!, issueNumber, kind: endpoint.kind });
}
