import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));

function read(name) {
  return readFileSync(resolve(directory, name), 'utf8');
}

describe('self-hosted iroh relay deployment', () => {
  it('retains the holepunch-only candidate configuration', () => {
    const config = read('relay.toml');

    expect(config).toMatch(/^enable_relay\s*=\s*false\s*(?:#.*)?$/m);
    expect(config).toMatch(/^enable_quic_addr_discovery\s*=\s*true\s*(?:#.*)?$/m);
    expect(config).toMatch(/^quic_bind_addr\s*=\s*"\[::\]:7842"\s*(?:#.*)?$/m);
    expect(config).toMatch(/^cert_mode\s*=\s*"Manual"\s*(?:#.*)?$/m);
    expect(config).toMatch(/^cert_dir\s*=\s*"\/etc\/iroh\/certs"\s*(?:#.*)?$/m);
  });

  it('keeps forwarding opt-in and separate from the default compose service', () => {
    const config = read('relay.toml');
    const compose = read('compose.yaml');
    const readme = read('README.md');

    expect(config).toMatch(/forwarding.*enable_relay\s*=\s*true/is);
    expect(compose).toMatch(/iroh-relay:holepunch-only/);
    expect(compose).not.toMatch(/iroh-relay:forwarding/);
    expect(readme).toMatch(/forwarding mode.*explicit|explicit.*forwarding mode/is);
  });

  it('keeps the upstream-1.1.0 holepunch-only candidate out of default deployments while its QAD/TLS gate is blocked', () => {
    const compose = read('compose.yaml');

    expect(compose).toMatch(/profiles:\s*\n\s*-\s*lane06-relay-gate-blocked/);
  });

  it('keeps the deployment stateless and isolated from the Happier server', () => {
    const compose = read('compose.yaml');
    expect(compose).toMatch(/read_only:\s*true/);
    expect(compose).toMatch(/cap_drop:\s*\n\s*-\s*ALL/);
    expect(compose).toMatch(/no-new-privileges:true/);
    expect(compose).toMatch(/tmpfs:/);
    const composeWithoutComments = compose.replace(/^\s*#.*$/gm, '');
    expect(composeWithoutComments).not.toMatch(/database|postgres|redis|server-secret/i);
    const volumeSection = compose.match(/\n\s+volumes:\n(?<body>(?:\s+-.*\n?)+)/)?.groups?.body ?? '';
    expect(volumeSection).toContain('relay.toml');
    expect(volumeSection).toContain('/certs');
    expect(volumeSection).not.toMatch(/database|postgres|redis|server-secret/i);
  });

  it('builds the relay from the exact locked native Iroh release line', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(/IROH_RELAY_VERSION=1\.1\.0/);
    expect(dockerfile).toMatch(/FROM\s+rust:1\.94\.0-bookworm@sha256:[a-f0-9]{64}\s+AS\s+builder/i);
    expect(dockerfile).toMatch(/cargo\s+install[\s\\\n]+.*iroh-relay.*--version[\s\\\n]+"?\$\{IROH_RELAY_VERSION\}"?.*--locked.*--features[\s\\\n]+server/is);
    expect(dockerfile).toMatch(/FROM\s+debian:bookworm-slim@sha256:[a-f0-9]{64}/i);
    expect(dockerfile).not.toMatch(/ghcr\.io\/n0-computer\/iroh-relay/i);
    expect(dockerfile).toMatch(/--config-path.*\/etc\/iroh\/relay\.toml/);
  });

  it('runs the holepunch-only image without privileged ports or Linux capabilities', () => {
    const config = read('relay.toml');
    const compose = read('compose.yaml');
    const dockerfile = read('Dockerfile');

    expect(config).toMatch(/^https_bind_addr\s*=\s*"\[::\]:8443"\s*(?:#.*)?$/m);
    expect(dockerfile).toMatch(/^USER\s+65532:65532\s*$/m);
    expect(compose).toMatch(/cap_drop:\s*\n\s*-\s*ALL/);
    expect(compose).toMatch(/"7842:7842\/udp"/);
  });
});
