// PKG-1 (lane 13 §9.2(2), campaign ruling 3.9 option (a)): an external Agent
// from a creator-added marketplace source is acquired by a fresh endpoint whose
// activation-local Home has never seen that source. Only the index fetch and the
// npm registry transport — genuine network boundaries — are replaced.
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { runnerArtifactTargetForPlatform } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';
import { createPluginCompatibilityProjectionV1, PluginManifestV2Schema } from '@happier-dev/protocol';
import { projectExpectedMarketplaceListing } from '@happier-dev/protocol/marketplace/internal';
import tweetnacl from 'tweetnacl';
import { afterEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  client: null as null | { getJson: (...args: unknown[]) => Promise<unknown>; getBody: (...args: unknown[]) => Promise<unknown> },
  snapshot: null as null | any,
  registryCalls: [] as string[],
  /** Authorization each registry client was created with; `null` is anonymous. */
  registryAuthorizations: [] as (string | null)[],
  /** When set, the registry answers only these bearer credentials and 401s everything else. */
  acceptedAuthorizations: null as null | readonly string[],
  indexLoads: [] as string[],
}));

vi.mock('@/auth/terminalAuthEnrollmentRuntime', () => ({
  acquireTerminalAuthEnrollmentRuntime: vi.fn(async () => ({ ok: true, runtime: {}, close: async () => undefined })),
}));

vi.mock('@/plugins/distribution/npm/httpsClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/plugins/distribution/npm/httpsClient')>(),
  createNpmRegistryHttpsClient: (options: Readonly<{ registryOrigin: string; authorizationHeader?: string }>) => {
    boundary.registryCalls.push(options.registryOrigin);
    boundary.registryAuthorizations.push(options.authorizationHeader ?? null);
    if (!boundary.client) throw new Error('registry access not expected');
    const accepted = boundary.acceptedAuthorizations;
    if (accepted && !accepted.includes(options.authorizationHeader ?? '')) {
      const refuse = async () => { throw new NpmRegistryHttpError(401); };
      return { getJson: refuse, getBody: refuse };
    }
    return boundary.client;
  },
}));

vi.mock('@/plugins/store/marketplace/indexSourceLoader', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/plugins/store/marketplace/indexSourceLoader')>(),
  loadMarketplaceIndexSource: async (params: Readonly<{ source: { id: string; sourceUrl: string } }>) => {
    boundary.indexLoads.push(params.source.id);
    if (params.source.sourceUrl !== CUSTOM_SOURCE_URL) throw new Error(`index not served: ${params.source.sourceUrl}`);
    if (!boundary.snapshot) throw new Error('index access not expected');
    return { ...boundary.snapshot, source: { ...boundary.snapshot.source, id: params.source.id } };
  },
}));

import { NpmRegistryHttpError } from '@/plugins/distribution/npm/httpsClient';
import { createNpmRegistryProfileService } from '@/plugins/distribution/npm/profiles/service';
import { createNpmRegistryProfileProbe } from '@/plugins/distribution/npm/profiles/probe';
import { createTestNpmTarball, sriSha512 } from '@/plugins/distribution/testkit/npmTarball';
import { SAMPLE_PLUGIN_FIXTURE_ROOT, SAMPLE_PLUGIN_ID } from '@/plugins/testkit/samplePackage';
import { createPluginRegistryStateStore } from '@/plugins/store/registry/currentState';
import { createMarketplaceIndexService } from '@/plugins/store/marketplace/service';
import { createMarketplaceSourceRegistryStore } from '@/plugins/store/marketplace/sources/store';

import { createProductionEphemeralRunnerApplication } from './runtimeIntegrations';
import packageJson from '../../package.json';

const roots: string[] = [];
const PACKAGE_NAME = '@acme/sample';
// The public npm registry needs no registry profile.
const REGISTRY_ORIGIN = 'https://registry.npmjs.org';
// A private registry needs an explicit registry profile on the Home that installs.
const PRIVATE_REGISTRY_ORIGIN = 'https://npm.acme.example.test';

function currentRunnerArtifactTarget() {
  const target = runnerArtifactTargetForPlatform({
    os: process.platform === 'win32' ? 'windows' : process.platform,
    arch: process.arch,
  });
  if (!target) throw new Error('Test host is not a supported Runner target');
  return target;
}

afterEach(async () => {
  boundary.client = null;
  boundary.snapshot = null;
  boundary.acceptedAuthorizations = null;
  boundary.registryCalls.length = 0;
  boundary.registryAuthorizations.length = 0;
  boundary.indexLoads.length = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeActivationFile(activationFilePath: string, seedByte: number): Promise<void> {
  const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(seedByte));
  await writeFile(activationFilePath, JSON.stringify({
    v: 1,
    home: {
      v: 1,
      homeServerIdentityId: 'srv_runner_home',
      canonicalServerUrl: 'https://home.example.test',
      revision: 1,
      endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
    },
    activation: {
      id: `00000000-0000-4000-8000-0000000000${seedByte}`,
      signingPrivateKeyBase64Url: encodeBase64(activationKey.secretKey, 'base64url'),
      creatorAccountId: 'creator-account',
      creatorTokenEpoch: 4,
      activationExpiresAt: null,
      workspace: { kind: 'choose_on_endpoint' as const },
      sessionId: 'runner-session',
      machineId: 'runner-machine',
      authoringCommitment: encodeBase64(new Uint8Array(32).fill(seedByte), 'base64url'),
      artifact: {
        product: 'happier-runner',
        version: packageJson.version,
        target: currentRunnerArtifactTarget(),
        sha256: 'f'.repeat(64),
      },
      endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'creator-account' },
    },
  }), { mode: 0o600 });
}

async function createSampleAgentNpmFixture(registryOrigin: string = REGISTRY_ORIGIN) {
  const manifestRaw = await readFile(join(SAMPLE_PLUGIN_FIXTURE_ROOT, '.happier-plugin', 'plugin.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw) as { version: string };
  const version = manifest.version;
  const compatibilityProjection = createPluginCompatibilityProjectionV1({
    manifest: PluginManifestV2Schema.parse(JSON.parse(manifestRaw)),
    uiArtifacts: { version: 2, entries: [] },
  });
  const archive = await createTestNpmTarball([
    {
      name: 'package/package.json',
      body: JSON.stringify({
        name: PACKAGE_NAME,
        version,
        keywords: ['happier-plugin'],
        files: ['.happier-plugin', 'daemon.mjs', 'agentRuntime.mjs'],
        happier: { manifest: '.happier-plugin/plugin.json', compatibilityProjection },
      }),
    },
    { name: 'package/.happier-plugin/plugin.json', body: manifestRaw },
    { name: 'package/daemon.mjs', body: await readFile(join(SAMPLE_PLUGIN_FIXTURE_ROOT, 'daemon.mjs'), 'utf8') },
    { name: 'package/agentRuntime.mjs', body: await readFile(join(SAMPLE_PLUGIN_FIXTURE_ROOT, 'agentRuntime.mjs'), 'utf8') },
  ]);
  const integrity = sriSha512(archive);
  const metadata = {
    name: PACKAGE_NAME,
    'dist-tags': { latest: version },
    versions: {
      [version]: {
        name: PACKAGE_NAME,
        version,
        happier: { manifest: '.happier-plugin/plugin.json', compatibilityProjection },
        dist: { integrity, tarball: `${registryOrigin}/${encodeURIComponent(PACKAGE_NAME)}/-/sample-${version}.tgz` },
      },
    },
  };
  const manifestDigest = `sha256:${createHash('sha256').update(manifestRaw).digest('hex')}`;
  const client = {
    getJson: async () => metadata,
    getBody: async () => ({ body: Readable.from([archive]), contentLength: archive.byteLength }),
  };
  const snapshot = {
    source: { id: 'acme-catalog', title: 'Acme catalog', kind: 'user', sourceUrl: CUSTOM_SOURCE_URL },
    freshness: { state: 'fresh', fetchedAtMs: 1 },
    diagnostics: [],
    entries: [{
      pluginId: SAMPLE_PLUGIN_ID,
      publisher: { id: 'acme', displayName: 'Acme' },
      display: { title: 'Acme Sample', description: 'Community npm plugin' },
      distribution: { kind: 'npm', packageName: PACKAGE_NAME, registryOrigin, version, integrity },
      manifestDigest,
      compatibility: { happier: '>=0.0.0', platforms: ['linux'] },
      summary: { contributions: [], requiredHostAccess: [], optionalHostAccess: [], executableRealms: ['daemon'] },
      review: { status: 'unreviewed', reviewedAt: null },
      categories: [],
      media: [],
      updatePolicy: 'allowed',
      links: {},
    }],
  };
  return { version, integrity, manifestDigest, client, snapshot };
}

const CUSTOM_SOURCE_URL = 'https://catalog.acme.example.test/index.json';

describe('Runner acquisition of an Agent from a creator-added marketplace source', () => {
  it('seeds the reviewed source in a fresh activation-local Home and installs the exact reviewed generation', async () => {
    const fixture = await createSampleAgentNpmFixture();
    boundary.client = fixture.client;
    boundary.snapshot = fixture.snapshot;

    // Creator machine: the user added this catalog, and the creator projects
    // the commitment exactly as the Temporary-computer creator does.
    const creatorHome = await mkdtemp(join(tmpdir(), 'runner-pkg1-creator-'));
    roots.push(creatorHome);
    const creatorSource = await createMarketplaceSourceRegistryStore({ happyHomeDir: creatorHome })
      .upsertSource({ sourceUrl: CUSTOM_SOURCE_URL, title: 'Acme catalog', enabled: true });
    const queried = await createMarketplaceIndexService({ happyHomeDir: creatorHome }).query({
      text: '', cursor: null, limit: 1,
      filters: { pluginIds: [SAMPLE_PLUGIN_ID], includeUnavailable: true },
    });
    const item = queried.items.find((candidate) => candidate.pluginId === SAMPLE_PLUGIN_ID) ?? null;
    expect(item).not.toBeNull();
    const commitment = projectExpectedMarketplaceListing(item as never, null);
    expect(commitment.source).toEqual({ id: creatorSource.id, kind: 'user', sourceUrl: CUSTOM_SOURCE_URL });

    // Endpoint: a fresh activation-local Home.
    const root = await mkdtemp(join(tmpdir(), 'runner-pkg1-endpoint-'));
    roots.push(root);
    const activationFilePath = join(root, 'happier-runner.activation.json');
    await writeActivationFile(activationFilePath, 41);
    const app = await createProductionEphemeralRunnerApplication({ activationFilePath });
    const activationHome = await mkdtemp(join(root, 'activation-home-'));

    const acquisition = await app.dependencies.prepareReviewedPluginAcquisition({
      manifest: { preparedAuthoring: { agentPluginDistribution: commitment } } as never,
      homeDirectory: activationHome,
      signal: new AbortController().signal,
    });
    if ('kind' in acquisition) throw new Error('A public registry needs no registry selection');
    expect(acquisition.review).toMatchObject({ pluginId: SAMPLE_PLUGIN_ID });
    await acquisition.apply({ signal: new AbortController().signal, optionalSelections: [] });

    const installed = await createPluginRegistryStateStore({ happyHomeDir: activationHome }).read();
    expect(installed.plugins[SAMPLE_PLUGIN_ID]).toBeDefined();
    // The endpoint seeded exactly the reviewed source, with no registry profile.
    const endpointSources = await createMarketplaceSourceRegistryStore({ happyHomeDir: activationHome }).listSources();
    expect(endpointSources.find((source) => source.id === commitment.source.id))
      .toMatchObject({ sourceUrl: CUSTOM_SOURCE_URL, origin: 'user', enabled: true });
    expect(endpointSources.find((source) => source.id === commitment.source.id)).not.toHaveProperty('registryProfileId');
  });

  it('asks the endpoint to select a private registry profile, never uses the creator credential, and installs through the canonical owners', async () => {
    const fixture = await createSampleAgentNpmFixture(PRIVATE_REGISTRY_ORIGIN);
    boundary.client = fixture.client;
    boundary.snapshot = fixture.snapshot;
    boundary.acceptedAuthorizations = ['Bearer creator-secret', 'Bearer endpoint-secret'];

    // Creator machine: the catalog is bound to the creator's own signed-in
    // registry profile, so the creator's listing is installable there.
    const creatorHome = await mkdtemp(join(tmpdir(), 'runner-pkg1-private-creator-'));
    roots.push(creatorHome);
    const creatorProfiles = createNpmRegistryProfileService({ happyHomeDir: creatorHome, probe: createNpmRegistryProfileProbe() });
    await creatorProfiles.mutate({
      action: 'add', machineId: 'creator-machine', expectedRevision: 0, mutationId: 'creator-add',
      profileId: 'creator_registry',
      profile: { displayName: 'Acme', origin: PRIVATE_REGISTRY_ORIGIN, scopes: ['@acme'], useAsDefault: false, allowPrivateNetwork: false },
    });
    await creatorProfiles.mutate({
      action: 'login', machineId: 'creator-machine', expectedRevision: 1, mutationId: 'creator-login',
      profileId: 'creator_registry', credential: { kind: 'bearer_token', secret: 'creator-secret' },
    });
    await creatorProfiles.mutate({
      action: 'test', machineId: 'creator-machine', expectedRevision: 2, mutationId: 'creator-test', profileId: 'creator_registry',
    });
    await createMarketplaceSourceRegistryStore({ happyHomeDir: creatorHome })
      .upsertSource({ sourceUrl: CUSTOM_SOURCE_URL, title: 'Acme catalog', enabled: true, registryProfileId: 'creator_registry' });
    const queried = await createMarketplaceIndexService({ happyHomeDir: creatorHome }).query({
      text: '', cursor: null, limit: 1,
      filters: { pluginIds: [SAMPLE_PLUGIN_ID], includeUnavailable: true },
    });
    const item = queried.items.find((candidate) => candidate.pluginId === SAMPLE_PLUGIN_ID) ?? null;
    expect(item?.artifactAccess).toEqual({ state: 'available', registryProfileId: 'creator_registry' });
    // Exactly what the Temporary-computer creator seals: no registry binding.
    const commitment = projectExpectedMarketplaceListing(item as never, null);
    boundary.registryCalls.length = 0;
    boundary.registryAuthorizations.length = 0;

    // Endpoint: a fresh activation-local Home that has no registry profile.
    const root = await mkdtemp(join(tmpdir(), 'runner-pkg1-private-endpoint-'));
    roots.push(root);
    const activationFilePath = join(root, 'happier-runner.activation.json');
    await writeActivationFile(activationFilePath, 42);
    const app = await createProductionEphemeralRunnerApplication({ activationFilePath });
    const activationHome = await mkdtemp(join(root, 'activation-home-'));
    const signal = new AbortController().signal;

    const first = await app.dependencies.prepareReviewedPluginAcquisition({
      manifest: { preparedAuthoring: { agentPluginDistribution: commitment } } as never,
      homeDirectory: activationHome,
      signal,
    });
    if (!('kind' in first)) throw new Error('Expected the endpoint to be asked for a registry profile');
    expect(first.requirement).toEqual({
      registryOrigin: PRIVATE_REGISTRY_ORIGIN,
      packageName: PACKAGE_NAME,
      registryProfileId: null,
    });
    // Nothing reached the private registry before the endpoint answered.
    expect(boundary.registryCalls).toEqual([]);

    const selected = await first.selectRegistryProfile({ credential: 'endpoint-secret', signal });
    if ('kind' in selected) throw new Error('Expected the installation review after the endpoint selection');
    expect(selected.review).toMatchObject({ pluginId: SAMPLE_PLUGIN_ID });
    await selected.apply({ signal, optionalSelections: [] });

    // The endpoint's own profile, created through the canonical profile
    // service, is the one binding the install used.
    const endpointProfiles = await createNpmRegistryProfileService({ happyHomeDir: activationHome }).snapshot();
    expect(endpointProfiles.profiles).toHaveLength(1);
    const endpointProfile = endpointProfiles.profiles[0]!;
    expect(endpointProfile).toMatchObject({ origin: PRIVATE_REGISTRY_ORIGIN, scopes: ['@acme'], hasCredentials: true });
    expect(endpointProfile.profileId).not.toBe('creator_registry');
    const endpointSource = (await createMarketplaceSourceRegistryStore({ happyHomeDir: activationHome }).listSources())
      .find((source) => source.id === commitment.source.id);
    expect(endpointSource?.registryProfileId).toBe(endpointProfile.profileId);
    const installed = await createPluginRegistryStateStore({ happyHomeDir: activationHome }).read();
    expect(installed.plugins[SAMPLE_PLUGIN_ID]?.install.trust?.distribution).toEqual({
      kind: 'npm',
      registryOrigin: PRIVATE_REGISTRY_ORIGIN,
      registryProfileId: endpointProfile.profileId,
      packageName: PACKAGE_NAME,
    });
    // Every endpoint registry request carried only the endpoint's credential.
    expect(boundary.registryAuthorizations.length).toBeGreaterThan(0);
    expect(new Set(boundary.registryAuthorizations)).toEqual(new Set(['Bearer endpoint-secret']));
  });
});
