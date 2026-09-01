import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const directory = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(resolve(directory, name), 'utf8');

describe('managed iroh relay deployment', () => {
  it('runs stock forwarding and QAD with open EndpointId admission by default', () => {
    const config = read('relay.toml');
    const compose = read('compose.yaml');
    expect(config).toMatch(/^enable_relay\s*=\s*true$/m);
    expect(config).toMatch(/^enable_quic_addr_discovery\s*=\s*true$/m);
    expect(config).toMatch(/^access\s*=\s*"everyone"$/m);
    expect(config).not.toMatch(/^access\.http\.|access\.shared_token|bearer_token\s*=/m);
    expect(compose).toMatch(/HAPPIER_IROH_RELAY_ADMISSION_URL:\s*["']?\$\{HAPPIER_IROH_RELAY_ADMISSION_URL:-\}/);
    expect(compose).toMatch(/IROH_RELAY_HTTP_BEARER_TOKEN:\s*["']?\$\{HAPPIER_IROH_RELAY_ADMISSION_TOKEN:-\}/);
  });

  it('enables private HTTP admission only with a complete operator allowlist assertion and token', () => {
    const entrypoint = resolve(directory, 'configure-and-run.sh');
    const baseEnv = {
      HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND: '100',
      HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES: '200',
      HAPPIER_IROH_RELAY_ADMISSION_URL: 'https://private.example/relay-admission',
    };

    const incomplete = spawnSync('sh', [entrypoint], { env: baseEnv, encoding: 'utf8' });
    expect(incomplete.status).toBe(64);
    expect(incomplete.stderr).toMatch(/complete operator allowlist/i);

    const missingToken = spawnSync('sh', [entrypoint], {
      env: { ...baseEnv, HAPPIER_IROH_RELAY_PRIVATE_ALLOWLIST_COMPLETE: 'true' },
      encoding: 'utf8',
    });
    expect(missingToken.status).toBe(64);
    expect(missingToken.stderr).toMatch(/admission token/i);

    const tokenWithoutCallback = spawnSync('sh', [entrypoint], {
      env: {
        HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND: '100',
        HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES: '200',
        IROH_RELAY_HTTP_BEARER_TOKEN: 'private-secret',
      },
      encoding: 'utf8',
    });
    expect(tokenWithoutCallback.status).toBe(64);
    expect(tokenWithoutCallback.stderr).toMatch(/configured together/i);
  });

  it('uses standard public ports, persistent operator TLS, private metrics, and upstream receive throttling', () => {
    const config = read('relay.toml');
    const compose = read('compose.yaml');
    expect(config).toMatch(/^http_bind_addr\s*=\s*"\[::\]:80"$/m);
    expect(config).toMatch(/^https_bind_addr\s*=\s*"\[::\]:443"$/m);
    expect(config).toMatch(/^quic_bind_addr\s*=\s*"\[::\]:7842"$/m);
    expect(config).toMatch(/^enable_metrics\s*=\s*true$/m);
    expect(config).toMatch(/^metrics_bind_addr\s*=\s*"\[::\]:9090"$/m);
    expect(config).toMatch(/\[limits\.client\.rx\][\s\S]*bytes_per_second\s*=/);
    expect(config).toMatch(/\[limits\.client\.rx\][\s\S]*max_burst_bytes\s*=/);
    expect(compose).toMatch(/"80:80\/tcp"/);
    expect(compose).toMatch(/"443:443\/tcp"/);
    expect(compose).toMatch(/"7842:7842\/udp"/);
    expect(compose).not.toMatch(/"9090:9090/);
    expect(compose).toContain('./certs:/etc/iroh/certs:ro');
  });

  it('requires operator-derived capacity inputs without self-verifying its container digest', () => {
    const compose = read('compose.yaml');
    const entrypoint = read('configure-and-run.sh');
    expect(compose).toMatch(/image:\s*["']?\$\{HAPPIER_IROH_RELAY_IMAGE:\?[^}]*@sha256/);
    expect(compose).toMatch(/HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND:\s*["']?\$\{HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND:\?/);
    expect(compose).toMatch(/HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES:\s*["']?\$\{HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES:\?/);
    expect(entrypoint).toMatch(/HAPPIER_IROH_RELAY_RX_BYTES_PER_SECOND/);
    expect(entrypoint).toMatch(/HAPPIER_IROH_RELAY_RX_MAX_BURST_BYTES/);
    expect(entrypoint).not.toMatch(/HAPPIER_IROH_RELAY_IMAGE|image_digest|sha256/);
  });

  it('rejects credential-bearing admission URLs before starting the relay', () => {
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
    expect(result.status).toBe(64);
    expect(result.stderr).toMatch(/unsupported URL characters/);
  });

  it('keeps the relay isolated from application data and secrets', () => {
    const compose = read('compose.yaml');
    expect(compose).toMatch(/read_only:\s*true/);
    expect(compose).toMatch(/cap_drop:\s*\n\s*-\s*ALL/);
    expect(compose).toMatch(/no-new-privileges:true/);
    expect(compose).toMatch(/tmpfs:/);
    expect(compose).not.toMatch(/database|postgres|redis|server-secret/i);
  });

  it('builds the exact locked native Iroh release from digest-pinned bases', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).toMatch(/IROH_RELAY_VERSION=1\.1\.0/);
    expect(dockerfile).toMatch(/FROM\s+rust:1\.94\.0-bookworm@sha256:[a-f0-9]{64}\s+AS\s+builder/i);
    expect(dockerfile).toMatch(/cargo\s+install[\s\\\n]+.*iroh-relay.*--version[\s\\\n]+"?\$\{IROH_RELAY_VERSION\}"?.*--locked.*--features[\s\\\n]+server/is);
    expect(dockerfile).toMatch(/FROM\s+debian:bookworm-slim@sha256:[a-f0-9]{64}/i);
    expect(dockerfile).not.toMatch(/ghcr\.io\/n0-computer\/iroh-relay/i);
    expect(dockerfile).toMatch(/THIRD-PARTY-NOTICES/);
  });
});
