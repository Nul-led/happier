import { describe, expect, it } from 'vitest';

import { buildOpenCodeManagedServerAttachSpec } from './attachSpec.js';

describe('buildOpenCodeManagedServerAttachSpec', () => {
  it('does not pin an explicitly V2 attached server to the preview-only health route', () => {
    const spec = buildOpenCodeManagedServerAttachSpec({
      id: 'opencode-server',
      baseUrl: 'http://127.0.0.1:49203',
      requestedDialect: 'v2',
    });
    expect(spec.healthCheck).toEqual({ kind: 'none' });
    expect(spec.clientAccess).toMatchObject({ kind: 'declaredSecretBasic' });
  });

  it('lets the canonical dialect probe choose the route for an Auto attached server', () => {
    const spec = buildOpenCodeManagedServerAttachSpec({
      id: 'opencode-server',
      baseUrl: 'http://127.0.0.1:49203',
      requestedDialect: 'auto',
    });
    expect(spec.healthCheck).toEqual({ kind: 'none' });
  });

  it('declares shaped V2 then V1 readiness when the managed-service owner owns Auto readiness', () => {
    const spec = buildOpenCodeManagedServerAttachSpec({
      id: 'opencode-external-browse',
      baseUrl: 'http://127.0.0.1:4096',
      requestedDialect: 'auto',
      autoReadiness: 'managedService',
    });

    expect(spec.healthCheck).toEqual({
      kind: 'http',
      alternatives: [
        {
          target: { kind: 'servicePath', path: '/api/info' },
          response: {
            kind: 'jsonObject',
            required: {
              version: 'nonEmptyString',
              pid: 'nonNegativeInteger',
              urls: 'array',
              paths: 'object',
            },
          },
        },
        {
          target: { kind: 'servicePath', path: '/global/health' },
          response: { kind: 'jsonObject', required: { healthy: 'true' } },
        },
      ],
      timeoutMs: 5_000,
    });
  });

  it('retains the legacy readiness route for explicit Stable attach', () => {
    const spec = buildOpenCodeManagedServerAttachSpec({
      id: 'opencode-server',
      baseUrl: 'http://127.0.0.1:49203',
      requestedDialect: 'v1',
    });
    expect(spec.healthCheck).toMatchObject({ target: { path: '/global/health' } });
  });
});
