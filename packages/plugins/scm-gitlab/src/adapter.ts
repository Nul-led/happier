import type { ScmHostingProviderRef } from '@happier-dev/plugin-sdk/scm/hosting';
import type {
  HostingProviderCompareUrlInput as ScmHostingProviderCompareUrlInput,
  HostingProviderRemoteDetectionInput as ScmHostingProviderRemoteDetectionInput,
  HostingProviderRoutingCapability as ScmHostingProviderRoutingCapability,
} from '@happier-dev/plugin-sdk/scm/hosting';
import type { ScmTransportIdentityV1 } from '@happier-dev/plugin-sdk/scm';

import { GITLAB_PLUGIN_ID } from './triage/contribution.js';
import { encodeCompareRef, parseScmRemoteUrl, stripTrailingSlash } from './remoteUrl.js';
import {
  GITLAB_PUBLIC_ORIGIN,
  normalizeGitlabConfiguredBaseUrl,
  type GitlabConfiguredOrigin,
} from './triage/origin.js';

export const GITLAB_SCM_HOSTING_PROVIDER_LOCAL_ID = 'gitlab';
export const GITLAB_SCM_HOSTING_PROVIDER_ID = `${GITLAB_PLUGIN_ID}/${GITLAB_SCM_HOSTING_PROVIDER_LOCAL_ID}`;
export const GITLAB_REMOTE_HOST_MATCHERS = Object.freeze({
  exactHosts: Object.freeze(['gitlab.com']),
});
export const GITLAB_URL_SAFETY = Object.freeze({
  allowedSchemes: Object.freeze(['https:']),
  allowedBaseUrls: Object.freeze(GITLAB_REMOTE_HOST_MATCHERS.exactHosts.map((host) => `https://${host}`)),
  allowedOrigins: Object.freeze(GITLAB_REMOTE_HOST_MATCHERS.exactHosts.map((host) => `https://${host}`)),
});

export type GitlabScmHostingProviderAdapter = ScmHostingProviderRoutingCapability & Readonly<{
  detectRemote(input: ScmHostingProviderRemoteDetectionInput): ScmHostingProviderRef | null;
  buildCompareUrl(input: ScmHostingProviderCompareUrlInput): string | null;
}>;

type GitlabHostMatcher = (host: string) => boolean;

export type GitlabScmHostingProviderAdapterOptions = Readonly<{
  hostMatcher?: GitlabHostMatcher;
  exactHosts?: readonly string[];
}>;

/** The port each transport implies when a remote names none. */
const IMPLIED_TRANSPORT_PORTS: Readonly<Record<'https:' | 'ssh:', number>> = Object.freeze({
  'https:': 443,
  'ssh:': 22,
});

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

function createExactHostMatcher(exactHosts: readonly string[]): GitlabHostMatcher {
  const normalizedHosts = new Set(exactHosts.map(normalizeHost));
  return (host) => normalizedHosts.has(normalizeHost(host));
}

/**
 * The endpoint a remote actually reaches, spelled the way a configured deployment is:
 * host plus a non-default port. The transport's own default folds away, so
 * `ssh://git@forge.example:22/…` and `git@forge.example:…` reach one deployment; every other
 * port is a different deployment and must not be dropped.
 */
function readRemoteForgeHostId(identity: ScmTransportIdentityV1): string {
  if (identity.syntax === 'scp') return identity.host;
  const port = identity.port === IMPLIED_TRANSPORT_PORTS[identity.protocol] ? null : identity.port;
  return port === null ? identity.host : `${identity.host}:${port}`;
}

/**
 * The configured deployments this detection may recognize, admitted through the source's own
 * configured-base normalizer so routing and reads agree on what a deployment is. The public
 * SaaS origin is excluded here: it is recognized by its own product-owned hostname, and letting
 * a configured base widen it would blur the two grants.
 */
function readConfiguredDeployments(
  connectedAccountBases: readonly string[] | undefined,
): readonly GitlabConfiguredOrigin[] {
  if (!connectedAccountBases?.length) return [];
  const deployments: GitlabConfiguredOrigin[] = [];
  for (const base of connectedAccountBases) {
    const normalized = normalizeGitlabConfiguredBaseUrl(base);
    if (!normalized || normalized.normalized === GITLAB_PUBLIC_ORIGIN) continue;
    if (deployments.some((candidate) => candidate.normalized === normalized.normalized)) continue;
    deployments.push(normalized);
  }
  return deployments;
}

/**
 * The configured deployment a remote sits beneath, or nothing. The longest configured prefix
 * wins so two deployments mounted under one host (`…/a` and `…/b`) stay distinct; the remaining
 * path is the repository, which GitLab spells with nested group segments.
 */
function resolveConfiguredDeploymentRepository(
  identity: ScmTransportIdentityV1,
  deployments: readonly GitlabConfiguredOrigin[],
): Readonly<{ deployment: GitlabConfiguredOrigin; nameWithOwner: string }> | null {
  const forgeHostId = readRemoteForgeHostId(identity);
  let best: Readonly<{ deployment: GitlabConfiguredOrigin; nameWithOwner: string }> | null = null;
  for (const deployment of deployments) {
    if (deployment.forgeHostId !== forgeHostId) continue;
    const prefix = deployment.pathPrefix.replace(/^\/+/, '');
    let repositoryPath = identity.path;
    if (prefix) {
      if (!identity.path.startsWith(`${prefix}/`)) continue;
      repositoryPath = identity.path.slice(prefix.length + 1);
    }
    const nameWithOwner = readNameWithOwner(repositoryPath);
    if (!nameWithOwner) continue;
    if (best === null || deployment.pathPrefix.length > best.deployment.pathPrefix.length) {
      best = { deployment, nameWithOwner };
    }
  }
  return best;
}

function readNameWithOwner(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  return segments.length >= 2 ? segments.join('/') : null;
}

function isSafeNameWithOwner(value: string): boolean {
  const segments = value.split('/');
  return segments.length >= 2 && segments.every((segment) => (
    segment.length > 0
    && segment !== '.'
    && segment !== '..'
    && !segment.includes('?')
    && !segment.includes('#')
  ));
}

function buildProviderRef(input: Readonly<{
  baseUrl: string;
  origin: string;
  nameWithOwner: string;
  remoteName: string | null;
}>): ScmHostingProviderRef {
  return {
    id: GITLAB_SCM_HOSTING_PROVIDER_ID,
    kind: 'gitlab' as const,
    displayName: 'GitLab',
    baseUrl: input.baseUrl,
    nameWithOwner: input.nameWithOwner,
    repositoryWebUrl: `${input.baseUrl}/${input.nameWithOwner}`,
    remoteName: input.remoteName ?? undefined,
    urlSafety: {
      allowedSchemes: ['https:'],
      allowedBaseUrls: [input.baseUrl],
      allowedOrigins: [input.origin],
    },
  };
}

function readTrustedBaseUrl(
  provider: ScmHostingProviderRef,
  matchesHost: GitlabHostMatcher,
  deployments: readonly GitlabConfiguredOrigin[],
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(provider.baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.search || parsed.hash) return null;
  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  if (pathSegments.some((segment) => segment === '.' || segment === '..')) return null;
  const pathPrefix = parsed.pathname.replace(/\/+$/, '');
  const baseUrl = `${parsed.origin}${pathPrefix}`;
  // A configured deployment is trusted as the exact base the account published, port and path
  // prefix included. Anything else must still be a product-owned host without a port.
  if (deployments.some((deployment) => deployment.normalized === baseUrl)) return baseUrl;
  if (parsed.port || !matchesHost(parsed.hostname)) return null;
  return baseUrl;
}

export function createGitlabScmHostingProviderAdapter(
  options?: GitlabScmHostingProviderAdapterOptions,
): GitlabScmHostingProviderAdapter {
  const matchesHost = options?.hostMatcher
    ?? createExactHostMatcher(options?.exactHosts ?? GITLAB_REMOTE_HOST_MATCHERS.exactHosts);

  return Object.freeze({
    detectRemote(input: ScmHostingProviderRemoteDetectionInput) {
      const parsed = parseScmRemoteUrl(input.remoteUrl);
      if (!parsed) return null;
      // A product-owned GitLab host is one origin without a port, so a ported remote on that
      // host is a different endpoint and falls through to the configured deployments instead.
      if (matchesHost(parsed.host) && readRemoteForgeHostId(parsed) === parsed.host) {
        const nameWithOwner = readNameWithOwner(parsed.path);
        if (!nameWithOwner) return null;
        const baseUrl = `https://${parsed.host}`;
        return buildProviderRef({
          baseUrl,
          origin: baseUrl,
          nameWithOwner,
          remoteName: input.remoteName,
        });
      }
      const configured = resolveConfiguredDeploymentRepository(
        parsed,
        readConfiguredDeployments(input.connectedAccountBases),
      );
      if (!configured) return null;
      return buildProviderRef({
        baseUrl: configured.deployment.normalized,
        origin: configured.deployment.origin,
        nameWithOwner: configured.nameWithOwner,
        remoteName: input.remoteName,
      });
    },
    buildCompareUrl(input: ScmHostingProviderCompareUrlInput) {
      const { provider } = input;
      if (
        provider.id !== GITLAB_SCM_HOSTING_PROVIDER_ID
        || provider.kind !== 'gitlab'
        || !provider.nameWithOwner
        || !isSafeNameWithOwner(provider.nameWithOwner)
      ) {
        return null;
      }
      const baseUrl = readTrustedBaseUrl(
        provider,
        matchesHost,
        readConfiguredDeployments(input.connectedAccountBases),
      );
      if (!baseUrl) return null;
      return `${stripTrailingSlash(baseUrl)}/${provider.nameWithOwner}/-/compare/${encodeCompareRef(input.base)}...${encodeCompareRef(input.head)}`;
    },
  });
}

export const gitlabHostingProviderAdapter = createGitlabScmHostingProviderAdapter();
