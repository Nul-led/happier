import { describe, expect, it } from 'vitest';

import { readGeneratedRuntimeDescriptorFromMetadata } from './generatedRuntimeProjection.js';

// A provider session id is minted by the Agent. The generated runtime
// projection reads it out of persisted session metadata and the runtime hands
// it straight back, so the projection must not re-canonicalize those bytes.
const OPAQUE_PROVIDER_SESSION_ID = '  provider\nses/AB+cd==  ';

describe('generated runtime descriptor projection', () => {
  it('projects an opaque-identifier field byte-exact', () => {
    const descriptor = readGeneratedRuntimeDescriptorFromMetadata(
      { backendMode: 'server', providerSessionId: OPAQUE_PROVIDER_SESSION_ID },
      {
        providerId: 'opencode',
        backendModeKey: 'backendMode',
        runtimeKind: { aliases: [{ input: 'server', runtimeKind: 'server' }] },
        fields: [
          { key: 'backendMode', kind: 'runtimeKind', runtimeHandle: 'whenPresent' },
          { key: 'providerSessionId', kind: 'opaqueIdentifier', runtimeHandle: 'whenPresent' },
        ],
        legacy: {
          fields: [
            { key: 'backendMode', kind: 'runtimeKind', runtimeHandle: 'whenPresent' },
            { key: 'providerSessionId', kind: 'opaqueIdentifier', runtimeHandle: 'whenPresent' },
          ],
        },
      },
    );

    expect(descriptor).toMatchObject({
      providerSessionId: OPAQUE_PROVIDER_SESSION_ID,
      runtimeHandle: { providerSessionId: OPAQUE_PROVIDER_SESSION_ID },
    });
  });

  it('treats an all-whitespace opaque identifier as absent', () => {
    const descriptor = readGeneratedRuntimeDescriptorFromMetadata(
      { backendMode: 'server', providerSessionId: '   \n  ' },
      {
        providerId: 'opencode',
        backendModeKey: 'backendMode',
        runtimeKind: { aliases: [{ input: 'server', runtimeKind: 'server' }] },
        fields: [
          { key: 'backendMode', kind: 'runtimeKind', runtimeHandle: 'whenPresent' },
          { key: 'providerSessionId', kind: 'opaqueIdentifier', runtimeHandle: 'whenPresent' },
        ],
        legacy: {
          fields: [
            { key: 'backendMode', kind: 'runtimeKind', runtimeHandle: 'whenPresent' },
            { key: 'providerSessionId', kind: 'opaqueIdentifier', runtimeHandle: 'whenPresent' },
          ],
        },
      },
    );

    expect(descriptor).toMatchObject({ providerSessionId: null });
  });

  it('still canonicalizes a Happier-owned trimmedString field', () => {
    const descriptor = readGeneratedRuntimeDescriptorFromMetadata(
      { backendMode: 'server', homePath: '  /tmp/home  ' },
      {
        providerId: 'opencode',
        backendModeKey: 'backendMode',
        runtimeKind: { aliases: [{ input: 'server', runtimeKind: 'server' }] },
        fields: [
          { key: 'backendMode', kind: 'runtimeKind', runtimeHandle: 'whenPresent' },
          { key: 'homePath', kind: 'trimmedString', runtimeHandle: 'whenPresent' },
        ],
        legacy: {
          fields: [
            { key: 'backendMode', kind: 'runtimeKind', runtimeHandle: 'whenPresent' },
            { key: 'homePath', kind: 'trimmedString', runtimeHandle: 'whenPresent' },
          ],
        },
      },
    );

    expect(descriptor).toMatchObject({ homePath: '/tmp/home' });
  });
});
