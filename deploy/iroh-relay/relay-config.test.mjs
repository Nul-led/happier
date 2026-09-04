import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(resolve(directory, name), 'utf8');

test('runs stock forwarding and QAD with open EndpointId admission by default', () => {
  const config = read('relay.toml');
  const compose = read('compose.yaml');
  assert.match(config, /^enable_relay\s*=\s*true$/m);
  assert.match(config, /^enable_quic_addr_discovery\s*=\s*true$/m);
  assert.match(config, /^access\s*=\s*"everyone"$/m);
  assert.doesNotMatch(config, /^access\.http\.|access\.shared_token|bearer_token\s*=/m);
  assert.match(compose, /HAPPIER_IROH_RELAY_ADMISSION_URL:\s*["']?\$\{HAPPIER_IROH_RELAY_ADMISSION_URL:-\}/);
  assert.match(compose, /IROH_RELAY_HTTP_BEARER_TOKEN:\s*["']?\$\{HAPPIER_IROH_RELAY_ADMISSION_TOKEN:-\}/);
});

test('enables private HTTP admission only with a complete operator allowlist assertion and token', () => {
  const entrypoint = resolve(directory, 'configure-and-run.sh');
  const baseEnv = {
    HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND: '100',
    HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES: '200',
    HAPPIER_IROH_RELAY_ADMISSION_URL: 'https://private.example/relay-admission',
  };

  const incomplete = spawnSync('sh', [entrypoint], { env: baseEnv, encoding: 'utf8' });
  assert.equal(incomplete.status, 64);
  assert.match(incomplete.stderr, /complete operator allowlist/i);

  const missingToken = spawnSync('sh', [entrypoint], {
    env: { ...baseEnv, HAPPIER_IROH_RELAY_PRIVATE_ALLOWLIST_COMPLETE: 'true' },
    encoding: 'utf8',
  });
  assert.equal(missingToken.status, 64);
  assert.match(missingToken.stderr, /admission token/i);

  const tokenWithoutCallback = spawnSync('sh', [entrypoint], {
    env: {
      HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND: '100',
      HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES: '200',
      IROH_RELAY_HTTP_BEARER_TOKEN: 'private-secret',
    },
    encoding: 'utf8',
  });
  assert.equal(tokenWithoutCallback.status, 64);
  assert.match(tokenWithoutCallback.stderr, /configured together/i);
});

test('uses standard public ports, persistent operator TLS, private metrics, and upstream receive throttling', () => {
  const config = read('relay.toml');
  const compose = read('compose.yaml');
  assert.match(config, /^http_bind_addr\s*=\s*"\[::\]:80"$/m);
  assert.match(config, /^https_bind_addr\s*=\s*"\[::\]:443"$/m);
  assert.match(config, /^quic_bind_addr\s*=\s*"\[::\]:7842"$/m);
  assert.match(config, /^enable_metrics\s*=\s*true$/m);
  assert.match(config, /^metrics_bind_addr\s*=\s*"\[::\]:9090"$/m);
  assert.match(config, /\[limits\.client\.rx\][\s\S]*bytes_per_second\s*=/);
  assert.match(config, /\[limits\.client\.rx\][\s\S]*max_burst_bytes\s*=/);
  assert.match(compose, /"80:80\/tcp"/);
  assert.match(compose, /"443:443\/tcp"/);
  assert.match(compose, /"7842:7842\/udp"/);
  assert.doesNotMatch(compose, /"9090:9090/);
  assert.ok(compose.includes('./certs:/etc/iroh/certs:ro'));
});

test('requires a non-empty image reference and operator-derived capacity inputs', () => {
  const compose = read('compose.yaml');
  const entrypoint = read('configure-and-run.sh');
  // Compose variable interpolation enforces presence only. `:?` fails on an
  // unset or empty value and its message repeats the required immutable form;
  // it never parses what the operator actually supplied.
  assert.match(compose, /image:\s*["']?\$\{HAPPIER_IROH_RELAY_IMAGE:\?[^}]*@sha256:digest[^}]*\}/);
  assert.match(compose, /HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND:\s*["']?\$\{HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND:\?/);
  assert.match(compose, /HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES:\s*["']?\$\{HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES:\?/);
  assert.match(entrypoint, /HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND/);
  assert.match(entrypoint, /HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES/);
  // No component of this deployment sees the image reference, so nothing here
  // can reject a mutable tag or check a digest.
  assert.doesNotMatch(entrypoint, /HAPPIER_IROH_RELAY_IMAGE|image_digest|sha256/);
  assert.doesNotMatch(compose, /HAPPIER_IROH_RELAY_IMAGE_DIGEST|imagetools|preflight/i);
});

test('documents the immutable image reference as an operator obligation the deployment cannot check', () => {
  const surfaces = [
    ['deploy/iroh-relay/README.md', read('README.md')],
    [
      'apps/docs/content/docs/self-hosting/iroh-relay.mdx',
      readFileSync(
        resolve(directory, '../../apps/docs/content/docs/self-hosting/iroh-relay.mdx'),
        'utf8',
      ),
    ],
  ];
  // Immutability is an operator obligation proven by the release publisher, not
  // by this deployment. Claiming that Compose refuses a mutable tag or verifies
  // a digest would require adding a real preflight owner and testing it first.
  const unbackedEnforcementClaim =
    /(refus\w+|reject\w+|validat\w+|verif\w+|enforc\w+)[^\n]{0,80}(mutable|@?sha256|digest)/i;
  for (const [name, text] of surfaces) {
    const flattened = text.replace(/\s+/g, ' ');
    assert.match(flattened, /registry\/repository@sha256:digest/, `${name} must state the immutable reference form`);
    assert.doesNotMatch(
      flattened,
      unbackedEnforcementClaim,
      `${name} must not claim the deployment enforces image immutability`,
    );
  }
});

test('rejects credential-bearing admission URLs before starting the relay', () => {
  const result = spawnSync('sh', [resolve(directory, 'configure-and-run.sh')], {
    env: {
      HAPPIER_IROH_RELAY_IMAGE: `registry.example/iroh@sha256:${'a'.repeat(64)}`,
      HAPPIER_IROH_RELAY_ADMISSION_URL: 'https://server.example/v1/iroh/relay/admission?token=secret',
      HAPPIER_IROH_RELAY_PRIVATE_ALLOWLIST_COMPLETE: 'true',
      HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND: '100',
      HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES: '200',
      IROH_RELAY_HTTP_BEARER_TOKEN: 'separate-secret',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /unsupported URL characters/);
});

test('keeps the relay isolated from application data and secrets', () => {
  const compose = read('compose.yaml');
  assert.match(compose, /read_only:\s*true/);
  assert.match(compose, /cap_drop:\s*\n\s*-\s*ALL/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /tmpfs:/);
  assert.doesNotMatch(compose, /database|postgres|redis|server-secret/i);
});

test('builds the exact locked native Iroh release from digest-pinned bases', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /IROH_RELAY_VERSION=1\.1\.0/);
  assert.match(dockerfile, /FROM\s+rust:1\.94\.0-bookworm@sha256:[a-f0-9]{64}\s+AS\s+builder/i);
  assert.match(dockerfile, /cargo\s+install[\s\\\n]+.*iroh-relay.*--version[\s\\\n]+"?\$\{IROH_RELAY_VERSION\}"?.*--locked.*--features[\s\\\n]+server/is);
  assert.match(dockerfile, /FROM\s+debian:bookworm-slim@sha256:[a-f0-9]{64}/i);
  assert.doesNotMatch(dockerfile, /ghcr\.io\/n0-computer\/iroh-relay/i);
  assert.match(dockerfile, /THIRD-PARTY-NOTICES/);
});

test('documents the pinned admission header an external private callback must read', () => {
  const readme = read('README.md');
  const publishedDocs = read('../../apps/docs/content/docs/self-hosting/iroh-relay.mdx');
  // Pinned iroh-relay 1.1.0 sends `X-Iroh-NodeId` (its constant is named
  // X_IROH_ENDPOINT_ID and its doc comment is stale). Happier ships no
  // admission callback route, so the operator's own service is the only reader
  // of that header and the README is its contract.
  assert.match(readme, /`X-Iroh-NodeId`/);
  assert.match(readme, /Happier server ships no admission callback route/);
  assert.match(publishedDocs, /`X-Iroh-NodeId`/);
  assert.match(publishedDocs, /Happier Server does not provide\s+a default callback route/);
});

test('documents current development browser Home and finite Machine source wiring without claiming release availability', () => {
  const readme = read('README.md');
  const publishedDocs = read('../../apps/docs/content/docs/self-hosting/iroh-relay.mdx');
  assert.match(readme, /browser carries Home HTTP and Socket\.IO over Iroh/i);
  assert.match(readme, /canonical finite import\/export owners/i);
  assert.match(readme, /complete A7\.4 path passed in[\s\S]*loaded Chromium/i);
  assert.match(readme, /does not claim stable or preview availability/i);
  assert.match(readme, /Lane 09 certification/i);
  assert.match(publishedDocs, /browser carries Home\s+HTTP and Socket\.IO over Iroh/i);
  assert.match(publishedDocs, /canonical finite file and attachment transfer owners/i);
  assert.match(publishedDocs, /does not claim stable or preview availability/i);
  assert.match(publishedDocs, /Lane 09 certification/i);
});

test('documents the exact upstream private admission allow response', () => {
  const surfaces = [
    ['deploy README', read('README.md')],
    ['published operator docs', read('../../apps/docs/content/docs/self-hosting/iroh-relay.mdx')],
  ];
  // The stock relay admits an endpoint only when its callback answers HTTP 200
  // with a body of exactly `true`; the operator's external service owns that
  // response, and this deployment only points the relay at it.
  for (const [name, text] of surfaces) {
    assert.match(text, /HTTP 200/, `${name} must state the allow status`);
    assert.match(text, /exactly `true`/, `${name} must state the allow body`);
  }
});

test('documents only effective pinned relay capacity controls and keeps QAD-only test scoped', () => {
  const surfaces = [
    ['deploy README', read('README.md')],
    ['published operator docs', read('../../apps/docs/content/docs/self-hosting/iroh-relay.mdx')],
  ];
  for (const [name, text] of surfaces) {
    assert.match(text, /accept_conn_limit/);
    assert.match(text, /accept_conn_burst/);
    assert.match(text, /unimplemented/);
    assert.match(text, /no-effect/);
    assert.match(text, /QAD-only[\s\S]{0,180}(tests|test)[\s\S]{0,180}(diagnostics|diagnostic)/i);
    assert.match(text, /not a\s+(supported )?production/i, `${name} must not present QAD-only as production`);
  }
});
