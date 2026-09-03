import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AMBIENT_DISCOVERY_GROUP,
  collectRustSources,
  collectSharedCoreSources,
  findForbiddenUsages,
  measureArtifacts,
} from './verify-browser-iroh-wasm.mjs';

test('an explicitly configured custom relay passes the browser transport contract', () => {
  const violations = findForbiddenUsages([
    {
      file: 'lib.rs',
      text: [
        'let config = EndpointConfig {',
        '    relay_urls: explicit_relay_urls,',
        '    relay_policy: RelayPolicy::Automatic,',
        '    ..EndpointConfig::default()',
        '};',
        'let endpoint = IrohEndpoint::bind(&config).await?;',
        'let alpn = happier_iroh_core::HOME_TUNNEL_ALPN;',
      ].join('\n'),
    },
  ]);

  assert.deepEqual(violations, []);
});

test('ambient n0 discovery and default relays fail the browser transport contract', () => {
  const violations = findForbiddenUsages([
    {
      file: 'lib.rs',
      text: [
        'let endpoint = iroh::Endpoint::builder(iroh::endpoint::presets::N0)',
        '    .relay_mode(iroh::RelayMode::Default)',
        '    .bind()',
        '    .await?;',
      ].join('\n'),
    },
  ]);

  assert.deepEqual(
    violations.map((violation) => ({ kind: violation.kind, pattern: violation.pattern })),
    [
      { kind: 'ambient-discovery', pattern: 'presets::N0' },
      { kind: 'core-owned', pattern: 'presets::' },
      { kind: 'core-owned', pattern: 'Endpoint::builder' },
      { kind: 'ambient-discovery', pattern: 'RelayMode::Default' },
      { kind: 'core-owned', pattern: 'RelayMode::' },
    ],
  );
});

test('a duplicated ALPN literal in the browser binding is a split-brain failure', () => {
  const violations = findForbiddenUsages([
    { file: 'lib.rs', text: 'connection.connect(b"happier/home-tunnel/1").await?;' },
  ]);

  assert.deepEqual(
    violations.map((violation) => violation.pattern),
    ['happier/home-tunnel'],
  );
});

test('comments may name the forbidden APIs they exclude', () => {
  const violations = findForbiddenUsages([
    { file: 'lib.rs', text: '// Never presets::N0 or RelayMode::Default: relays are explicit.' },
  ]);

  assert.deepEqual(violations, []);
});

test('the repository owns a browser Iroh binding crate with no forbidden usage', () => {
  const sources = collectRustSources(
    new URL('../rust/happier-iroh-wasm/src', import.meta.url).pathname,
  );
  assert.ok(sources.length > 0, 'happier-iroh-wasm must contain Rust sources');
  assert.deepEqual(findForbiddenUsages(sources), []);
});

test('the shared core owns the endpoint builder and ALPN literals the browser must not restate', () => {
  // The core-owned patterns apply to the browser binding, never to the core
  // itself: the core IS the owner. Only ambient discovery is forbidden there,
  // and how it formats its own calls is not this gate's business.
  const violations = findForbiddenUsages(
    [
      {
        file: 'endpoint.rs',
        text: [
          'let builder = iroh::Endpoint::builder(iroh::endpoint::presets::Minimal)',
          '    .alpns(',
          '        inbound_alpns(TARGET_INBOUND_ALPN_ROLE),',
          '    )',
          '    .relay_mode(relay_mode);',
          'pub const HOME_TUNNEL_ALPN: &[u8] = b"happier/home-tunnel/1";',
        ].join('\n'),
      },
    ],
    AMBIENT_DISCOVERY_GROUP,
  );

  assert.deepEqual(violations, []);
});

test('ambient n0 discovery in the shared core is a violation however it is formatted', () => {
  const violations = findForbiddenUsages(
    [
      {
        file: 'endpoint.rs',
        text: [
          'let builder = iroh::Endpoint::builder(',
          '    iroh::endpoint::presets::N0,',
          ')',
          '    .relay_mode(',
          '        iroh::RelayMode::Default,',
          '    );',
        ].join('\n'),
      },
    ],
    AMBIENT_DISCOVERY_GROUP,
  );

  assert.deepEqual(
    violations.map((violation) => ({ kind: violation.kind, pattern: violation.pattern })),
    [
      { kind: 'ambient-discovery', pattern: 'presets::N0' },
      { kind: 'ambient-discovery', pattern: 'RelayMode::Default' },
    ],
  );
});

test('the shared core endpoint and relay owner is scanned and reaches for no ambient discovery', () => {
  const sources = collectSharedCoreSources();
  assert.ok(
    sources.some((source) => source.file === 'endpoint.rs'),
    'the canonical endpoint/relay owner must be part of the scanned set',
  );
  assert.deepEqual(findForbiddenUsages(sources, AMBIENT_DISCOVERY_GROUP), []);
});

test('artifact measurement reports real byte and gzip sizes', () => {
  const measured = measureArtifacts([
    { label: 'self', path: new URL('./verify-browser-iroh-wasm.mjs', import.meta.url).pathname },
  ]);
  assert.equal(measured.length, 1);
  assert.ok(measured[0].bytes > 0);
  assert.ok(measured[0].gzipBytes > 0);
  assert.ok(measured[0].gzipBytes < measured[0].bytes);
});
