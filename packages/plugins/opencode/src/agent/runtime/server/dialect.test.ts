import { describe, expect, it, vi } from 'vitest';

import {
  detectOpenCodeServerDialect,
  HAPPIER_OPENCODE_SERVER_DIALECT_ENV_KEY,
  normalizeOpenCodeV2InstanceEvent,
  openCodeServerHealthPath,
  OPEN_CODE_V1_HEALTH_PATH,
  OPEN_CODE_V2_HEALTH_PATH,
  OPEN_CODE_V2_INFO_PATH,
  readOpenCodeManagedServerDialect,
  readRequestedOpenCodeServerDialect,
  resolveRequestedOpenCodeServerDialect,
  usesOpenCodeConnectedServiceRequestAuth,
} from './dialect.js';
import { OPENCODE_CONNECTED_SERVICE_SELECTION_IDENTITY_ENV } from './managedServerState.js';
import { OPEN_CODE_REQUEST_AUTH_CAPABILITY_PATH_ENV } from '../../auth/services/requestAuth/env.js';
import type { OpenCodeRuntimeFetch } from './openCodeServerClient.js';

function jsonResponse(status: number, body: unknown): Awaited<ReturnType<OpenCodeRuntimeFetch>> {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { 'content-type': 'application/json' },
    text: async () => JSON.stringify(body),
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe('readRequestedOpenCodeServerDialect', () => {
  it('reads the opt-in from the launch environment', () => {
    expect(readRequestedOpenCodeServerDialect({
      [HAPPIER_OPENCODE_SERVER_DIALECT_ENV_KEY]: ' V2 ',
    })).toBe('v2');
  });

  it('defaults to auto for a missing, empty, or unrecognised value', () => {
    expect(readRequestedOpenCodeServerDialect(undefined)).toBe('auto');
    expect(readRequestedOpenCodeServerDialect({})).toBe('auto');
    expect(readRequestedOpenCodeServerDialect({
      [HAPPIER_OPENCODE_SERVER_DIALECT_ENV_KEY]: '',
    })).toBe('auto');
    expect(readRequestedOpenCodeServerDialect({
      [HAPPIER_OPENCODE_SERVER_DIALECT_ENV_KEY]: 'v3',
    })).toBe('auto');
  });
});

describe('resolveRequestedOpenCodeServerDialect', () => {
  it('keeps an explicit configured generation authoritative for an external server', () => {
    expect(resolveRequestedOpenCodeServerDialect({
      configuredGeneration: 'stable',
      values: { [HAPPIER_OPENCODE_SERVER_DIALECT_ENV_KEY]: 'v2' },
      managedServerDialect: null,
    })).toBe('v1');
    expect(resolveRequestedOpenCodeServerDialect({
      configuredGeneration: 'v2',
      values: {},
      managedServerDialect: null,
    })).toBe('v2');
  });

  it('asks for V2 when Happier itself is about to run the opencode2 binary', () => {
    // The binary decides which routes the child mounts. An owned `opencode2`
    // server serves only `/api/*`, so leaving the request dialect at `auto`
    // would point every request at routes that server does not have.
    expect(resolveRequestedOpenCodeServerDialect({
      values: {},
      managedServerDialect: 'v2',
    })).toBe('v2');
  });

  it('keeps the launch-environment opt-in for a server Happier did not spawn', () => {
    expect(resolveRequestedOpenCodeServerDialect({
      values: { [HAPPIER_OPENCODE_SERVER_DIALECT_ENV_KEY]: 'v2' },
      managedServerDialect: null,
    })).toBe('v2');
    expect(resolveRequestedOpenCodeServerDialect({
      values: {},
      managedServerDialect: null,
    })).toBe('auto');
    expect(resolveRequestedOpenCodeServerDialect({
      values: {},
      managedServerDialect: 'v1',
    })).toBe('auto');
  });
});

describe('usesOpenCodeConnectedServiceRequestAuth', () => {
  it('does not mistake direct connected-account materialization for request auth', () => {
    expect(usesOpenCodeConnectedServiceRequestAuth({
      [OPENCODE_CONNECTED_SERVICE_SELECTION_IDENTITY_ENV]: 'materialization-1',
    })).toBe(false);
  });

  it('detects a launch that carries the request-auth capability path', () => {
    expect(usesOpenCodeConnectedServiceRequestAuth({
      [OPEN_CODE_REQUEST_AUTH_CAPABILITY_PATH_ENV]: '/tmp/capability.sock',
    })).toBe(true);
  });

  it('is false for a launch with neither, or with blank values', () => {
    expect(usesOpenCodeConnectedServiceRequestAuth(undefined)).toBe(false);
    expect(usesOpenCodeConnectedServiceRequestAuth({})).toBe(false);
    expect(usesOpenCodeConnectedServiceRequestAuth({
      [OPENCODE_CONNECTED_SERVICE_SELECTION_IDENTITY_ENV]: '   ',
      [OPEN_CODE_REQUEST_AUTH_CAPABILITY_PATH_ENV]: '',
    })).toBe(false);
  });
});

/**
 * Health answers shaped exactly like the pinned official discriminator's own
 * fixtures (`comparators/opencode/packages/app/src/utils/server-protocol.test.ts`
 * at `10765ff2a9da8c3b88e4de873aa383a49c318912`).
 */
function healthProbeFetch(
  answers: Readonly<Record<string, Awaited<ReturnType<OpenCodeRuntimeFetch>>>>,
): ReturnType<typeof vi.fn<OpenCodeRuntimeFetch>> {
  return vi.fn<OpenCodeRuntimeFetch>(async (request) =>
    answers[request.url] ?? jsonResponse(404, { error: 'not found' }));
}

describe('detectOpenCodeServerDialect', () => {
  it('detects released OpenCode 2.0.15 from authenticated /api/info when /api/health is absent', async () => {
    const fetch = healthProbeFetch({
      '/api/info': jsonResponse(200, { version: '2.0.15', pid: 123, urls: [], paths: { tmp: '/tmp' } }),
    });
    await expect(detectOpenCodeServerDialect({ fetch, requested: 'auto' }))
      .resolves.toMatchObject({ dialect: 'v2', probe: { path: '/api/info', status: 200 } });
  });

  it('keeps explicit stable and V2 requests authoritative without re-probing', async () => {
    const fetch = vi.fn<OpenCodeRuntimeFetch>(async () => jsonResponse(200, { healthy: true }));

    await expect(detectOpenCodeServerDialect({ fetch, requested: 'v1' }))
      .resolves.toEqual({ dialect: 'v1', requested: 'v1', probe: null });
    await expect(detectOpenCodeServerDialect({ fetch, requested: 'v2' }))
      .resolves.toEqual({ dialect: 'v2', requested: 'v2', probe: null });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('auto-detects the exact surface the pinned V2 server serves', async () => {
    // `packages/server/src/api.ts` builds `makeDefaultApi(...)`, whose only
    // liveness route is `GET /api/health` answering the literal
    // `{ healthy: true }` of `packages/protocol/src/groups/health.ts`. No
    // `/global` group is mounted and nothing in `packages/server/src` emits a
    // `pid`, so this is the whole observable V2 health surface.
    const fetch = healthProbeFetch({
      [OPEN_CODE_V2_HEALTH_PATH]: jsonResponse(200, { healthy: true }),
    });

    const detection = await detectOpenCodeServerDialect({ fetch, requested: 'auto' });

    expect(detection.dialect).toBe('v2');
    expect(detection.probe).toMatchObject({ path: OPEN_CODE_V2_HEALTH_PATH, status: 200 });
    // Same probe order as the official discriminator: legacy first, then `/api`.
    expect(fetch.mock.calls.map((call) => call[0]?.url)).toEqual([
      OPEN_CODE_V1_HEALTH_PATH,
      OPEN_CODE_V2_HEALTH_PATH,
    ]);
    expect(fetch.mock.calls[1]?.[0]).toMatchObject({
      url: OPEN_CODE_V2_HEALTH_PATH,
      method: 'GET',
    });
  });

  it('bounds each health probe independently so a stalled legacy route cannot block V2 fallback', async () => {
    const fetch = healthProbeFetch({
      [OPEN_CODE_V2_HEALTH_PATH]: jsonResponse(200, { healthy: true }),
    });

    await expect(detectOpenCodeServerDialect({ fetch, requested: 'auto' }))
      .resolves.toMatchObject({ dialect: 'v2' });

    expect(fetch.mock.calls.map((call) => call[0]?.timeoutMs)).toEqual([2_000, 2_000]);
  });

  it('stays on v1 for a transitional server that answers both routes without a process identifier', async () => {
    // The pinned V1 binary mounts the `/api/*` protocol groups alongside its own
    // root and `/global/*` routes (`OpenCodeHttpApi` in
    // `packages/opencode/src/server/routes/instance/httpapi/api.ts`), so a
    // stable server answers both and neither answer carries a `pid`. The legacy
    // route is the only thing that separates it from a V2 server.
    const fetch = healthProbeFetch({
      [OPEN_CODE_V1_HEALTH_PATH]: jsonResponse(200, { healthy: true, version: '1.18.25' }),
      [OPEN_CODE_V2_HEALTH_PATH]: jsonResponse(200, { healthy: true }),
    });

    const detection = await detectOpenCodeServerDialect({ fetch, requested: 'auto' });

    expect(detection.dialect).toBe('v1');
    expect(detection.probe).toMatchObject({ path: OPEN_CODE_V1_HEALTH_PATH, status: 200 });
    // A decided legacy answer settles the question; `/api/health` is not asked.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stays on v1 for a legacy-only server', async () => {
    const fetch = healthProbeFetch({
      [OPEN_CODE_V1_HEALTH_PATH]: jsonResponse(200, { healthy: true, version: '1.14.0' }),
    });

    const detection = await detectOpenCodeServerDialect({ fetch, requested: 'auto' });

    expect(detection.dialect).toBe('v1');
    expect(detection.probe).toMatchObject({ path: OPEN_CODE_V1_HEALTH_PATH, status: 200 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('decides on the healthy marker alone, never on a process identifier', async () => {
    // The official client's `typeof pid === 'number'` branch is unreachable
    // against every pinned server, so mirroring it made v2 unselectable. The
    // marker is what both generations actually publish.
    await expect(detectOpenCodeServerDialect({
      fetch: healthProbeFetch({
        [OPEN_CODE_V2_HEALTH_PATH]: jsonResponse(200, { healthy: true, pid: 'not-a-number' }),
      }),
      requested: 'auto',
    })).resolves.toMatchObject({ dialect: 'v2' });

    await expect(detectOpenCodeServerDialect({
      fetch: healthProbeFetch({
        [OPEN_CODE_V2_HEALTH_PATH]: jsonResponse(200, { pid: 123 }),
      }),
      requested: 'auto',
    })).resolves.toMatchObject({ dialect: 'v1' });
  });

  it('stays on v1 when /api/health reports itself unhealthy', async () => {
    const fetch = healthProbeFetch({
      [OPEN_CODE_V2_HEALTH_PATH]: jsonResponse(200, { healthy: false }),
    });

    await expect(detectOpenCodeServerDialect({ fetch, requested: 'auto' }))
      .resolves.toMatchObject({ dialect: 'v1' });
  });

  it('falls back to v1 when the requested server has no /api surface', async () => {
    const fetch = vi.fn<OpenCodeRuntimeFetch>(async () => jsonResponse(404, { error: 'not found' }));

    const detection = await detectOpenCodeServerDialect({ fetch, requested: 'auto' });

    expect(detection.dialect).toBe('v1');
    expect(detection.probe).toMatchObject({ path: OPEN_CODE_V2_HEALTH_PATH, status: 404 });
  });

  it('falls back to v1 when /api/health answers without a usable body', async () => {
    const fetch = healthProbeFetch({
      [OPEN_CODE_V2_HEALTH_PATH]: {
        ok: true,
        status: 200,
        statusText: '',
        headers: { 'content-type': 'text/html' },
        text: async () => '<html>proxy</html>',
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
        arrayBuffer: async () => new ArrayBuffer(0),
      },
    });

    await expect(detectOpenCodeServerDialect({ fetch, requested: 'auto' }))
      .resolves.toMatchObject({ dialect: 'v1' });
  });

  it('fails toward the proven v1 transport and reports the probe error', async () => {
    const probeError = new Error('socket hang up');
    const fetch = vi.fn<OpenCodeRuntimeFetch>(async () => {
      throw probeError;
    });

    const detection = await detectOpenCodeServerDialect({ fetch, requested: 'auto' });

    expect(detection.dialect).toBe('v1');
    expect(detection.probe).toMatchObject({
      path: OPEN_CODE_V2_HEALTH_PATH,
      status: null,
      error: probeError,
    });
  });
});

describe('openCodeServerHealthPath', () => {
  it('names the liveness route each generation actually mounts', () => {
    expect(openCodeServerHealthPath('v1')).toBe(OPEN_CODE_V1_HEALTH_PATH);
    expect(openCodeServerHealthPath('v2')).toBe(OPEN_CODE_V2_HEALTH_PATH);
    expect(openCodeServerHealthPath('v2', '/usr/local/bin/opencode')).toBe(OPEN_CODE_V2_INFO_PATH);
    expect(openCodeServerHealthPath('v2', '/custom/bin/opencode-current')).toBe(OPEN_CODE_V2_INFO_PATH);
    expect(openCodeServerHealthPath('v2', '/usr/local/bin/opencode2')).toBe(OPEN_CODE_V2_HEALTH_PATH);
  });
});

describe('readOpenCodeManagedServerDialect', () => {
  it('reads the V2 beta executable by its exact resolved name', () => {
    expect(readOpenCodeManagedServerDialect('/usr/local/bin/opencode2')).toBe('v2');
    expect(readOpenCodeManagedServerDialect('C:\\Users\\dev\\bin\\opencode2.cmd')).toBe('v2');
    expect(readOpenCodeManagedServerDialect('C:\\Users\\dev\\bin\\OpenCode2.EXE')).toBe('v2');
  });

  it('keeps the stable executable on the legacy route', () => {
    expect(readOpenCodeManagedServerDialect('/usr/local/bin/opencode')).toBe('v1');
    expect(readOpenCodeManagedServerDialect('C:\\Users\\dev\\bin\\opencode.cmd')).toBe('v1');
  });

  it('never infers the beta from a name that merely contains it', () => {
    expect(readOpenCodeManagedServerDialect('/usr/local/bin/opencode2-wrapper')).toBe('v1');
    expect(readOpenCodeManagedServerDialect('/opt/opencode2/bin/opencode')).toBe('v1');
  });

  it('falls back to the proven route when no executable is known', () => {
    expect(readOpenCodeManagedServerDialect(null)).toBe('v1');
    expect(readOpenCodeManagedServerDialect(undefined)).toBe('v1');
    expect(readOpenCodeManagedServerDialect('   ')).toBe('v1');
  });
});

describe('normalizeOpenCodeV2InstanceEvent', () => {
  it('renames the V2 envelope into the runtime-domain event shape', () => {
    expect(normalizeOpenCodeV2InstanceEvent(
      {
        id: 'evt_1',
        type: 'message.part.updated',
        data: { sessionID: 'ses_1', part: { type: 'text' } },
        location: { directory: '/tmp/project' },
        durable: { aggregateID: 'ses_1', seq: 4, version: 1 },
      },
      '/tmp/project',
    )).toEqual({
      type: 'message.part.updated',
      properties: { sessionID: 'ses_1', part: { type: 'text' } },
    });
  });

  it('drops an event addressed to a different directory', () => {
    expect(normalizeOpenCodeV2InstanceEvent(
      { type: 'session.updated', data: {}, location: { directory: '/tmp/other' } },
      '/tmp/project',
    )).toBeNull();
  });

  it('keeps an instance-wide event that carries no location', () => {
    expect(normalizeOpenCodeV2InstanceEvent(
      { type: 'server.connected', data: {} },
      '/tmp/project',
    )).toEqual({ type: 'server.connected', properties: {} });
  });

  it('renames the V2 text delta onto the part-delta type the domain observes', () => {
    // Released V2 replaced V1's `message.part.delta` with `session.text.delta`.
    // The domain reads only `messageID` from that event, to observe which
    // assistant message the running turn owns.
    expect(normalizeOpenCodeV2InstanceEvent(
      {
        id: 'evt_3',
        type: 'session.text.delta',
        data: {
          timestamp: 17,
          sessionID: 'ses_1',
          assistantMessageID: 'msg_42',
          ordinal: 1,
          delta: 'hel',
        },
        location: { directory: '/tmp/project' },
      },
      '/tmp/project',
    )).toEqual({
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_1',
        partID: 'msg_42:text:1',
        partType: 'text',
        delta: 'hel',
        messageID: 'msg_42',
      },
    });
  });

  it('keeps a schema-invalid text delta observable without inventing an identity', () => {
    expect(normalizeOpenCodeV2InstanceEvent(
      { type: 'session.text.delta', data: { sessionID: 'ses_1', delta: 'x' } },
      null,
    )).toEqual({
      type: 'message.part.delta',
      properties: { sessionID: 'ses_1', delta: 'x', partID: '', partType: 'text', messageID: undefined },
    });
  });

  it('renames the V2 permission ask and remaps its action and resources', () => {
    // Released `packages/schema/src/permission.ts` publishes `permission.asked`
    // and names the permission in `action`
    // with `resources` where V1 carried `patterns`.
    expect(normalizeOpenCodeV2InstanceEvent(
      {
        id: 'evt_4',
        type: 'permission.asked',
        data: {
          id: 'per_1',
          sessionID: 'ses_1',
          action: 'bash',
          resources: ['rm *'],
          metadata: { reason: 'destructive' },
        },
        location: { directory: '/tmp/project' },
      },
      '/tmp/project',
    )).toEqual({
      type: 'permission.asked',
      properties: {
        id: 'per_1',
        sessionID: 'ses_1',
        permission: 'bash',
        patterns: ['rm *'],
        metadata: { reason: 'destructive' },
        always: [],
      },
    });
  });

  it('projects a released V2 form onto the incumbent question owner', () => {
    expect(normalizeOpenCodeV2InstanceEvent(
      {
        id: 'evt_5',
        type: 'form.created',
        data: {
          form: {
            id: 'form_1',
            sessionID: 'ses_1',
            fields: [{ key: 'ship', type: 'string', title: 'Ship', description: 'Ship it?', options: [{ label: 'Yes', value: 'yes' }] }],
          },
        },
      },
      '/tmp/project',
    )).toEqual({
      type: 'question.asked',
      properties: {
        id: 'form_1',
        sessionID: 'ses_1',
        questions: [{ question: 'Ship it?', header: 'Ship', options: [{ label: 'Yes' }], multiple: false }],
      },
    });
  });

  it('rejects a frame without a usable type', () => {
    expect(normalizeOpenCodeV2InstanceEvent({ data: {} }, '/tmp/project')).toBeNull();
    expect(normalizeOpenCodeV2InstanceEvent(null, '/tmp/project')).toBeNull();
  });
});

/**
 * Bytes OpenCode minted. The V2 text delta carries the assistant message id the
 * running turn is attributed to; re-minting it detaches the delta from its turn.
 */
const PROVIDER_MINTED_MESSAGE_ID = '  provider\nmsg/AB+cd==  ';

describe('normalizeOpenCodeV2InstanceEvent provider identity', () => {
  it('projects the assistant message id as the exact bytes the server sent', () => {
    expect(normalizeOpenCodeV2InstanceEvent(
      {
        id: 'evt_exact',
        type: 'session.text.delta',
        data: {
          sessionID: 'ses_1',
          assistantMessageID: PROVIDER_MINTED_MESSAGE_ID,
          delta: 'hel',
        },
        location: { directory: '/tmp/project' },
      },
      '/tmp/project',
    )).toEqual({
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_1',
        delta: 'hel',
        partID: `${PROVIDER_MINTED_MESSAGE_ID}:text:0`,
        partType: 'text',
        messageID: PROVIDER_MINTED_MESSAGE_ID,
      },
    });
  });

  it('does not mint an identity for a whitespace-only assistant message id', () => {
    expect(normalizeOpenCodeV2InstanceEvent(
      {
        id: 'evt_blank',
        type: 'session.text.delta',
        data: { sessionID: 'ses_1', assistantMessageID: '  \n ', delta: 'hel' },
        location: { directory: '/tmp/project' },
      },
      '/tmp/project',
    )).toEqual({
      type: 'message.part.delta',
      properties: {
        sessionID: 'ses_1',
        delta: 'hel',
        partID: '',
        partType: 'text',
        messageID: '  \n ',
      },
    });
  });
});
